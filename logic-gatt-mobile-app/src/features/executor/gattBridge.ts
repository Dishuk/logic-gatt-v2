/**
 * GATT bridge — the whole job of the BLE executor.
 *
 * Wraps the `expo-gatt-server` native module and translates between wire
 * `PluginCommand`s (from the desktop) and native GATT operations, relaying
 * native GATT events back as `PluginEvent`s. The phone holds NO scenario logic;
 * it just executes and forwards, exactly like the old ESP32 / dongle plugin.
 */

import * as Gatt from 'expo-gatt-server';
import { GATT_SUCCESS } from 'expo-gatt-server';

import type { Logger } from '@/lib/logger';

import { ensureBlePermissions } from './permissions';
import {
  mapSchemaToGatt,
  type DeviceSettings,
  type PluginCommand,
  type PluginEvent,
  type Schema,
} from './protocol';

/** A read request the central is waiting on, pending a `respond-to-read`. */
interface PendingRead {
  deviceId: string;
  requestId: number;
  offset: number;
}

export interface BridgeDeps {
  /** Send a `PluginEvent` up the WebSocket to the desktop. */
  send: (event: PluginEvent) => void;
  /** Levelled logger (surfaces in the phone UI + console; also mirrored to desktop by the caller). */
  log: Logger;
}

export interface BridgeState {
  advertising: boolean;
  /** Non-null when the last advertise attempt failed (permission/create/advertise). */
  advError: string | null;
  deviceName?: string;
  serviceCount: number;
  centrals: string[];
}

type Subscription = { remove: () => void };

/** Best-effort numeric error code from a thrown value (native modules attach `.code`). */
function errorCodeOf(err: unknown): number {
  if (err && typeof err === 'object') {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'number') return code;
    if (typeof code === 'string') {
      const n = Number.parseInt(code, 10);
      if (!Number.isNaN(n)) return n;
    }
  }
  return 0;
}

function errorMessageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return String(err);
}

/** Stable key for a characteristic within the active schema. */
function charKey(serviceUuid: string, charUuid: string): string {
  return `${serviceUuid.toLowerCase()}|${charUuid.toLowerCase()}`;
}

export class GattBridge {
  private send: (event: PluginEvent) => void;
  private log: Logger;

  private schema: Schema | null = null;
  private settings: DeviceSettings | null = null;
  private advertising = false;
  private advError: string | null = null;
  private readonly centrals = new Set<string>();
  /** Pending reads keyed by `serviceUuid|charUuid`; newest is answered first. */
  private readonly pendingReads = new Map<string, PendingRead[]>();
  /** Fast lookup of characteristics declared by the active schema. */
  private readonly knownChars = new Set<string>();

  private subscriptions: Subscription[] = [];

  constructor(deps: BridgeDeps) {
    this.send = deps.send;
    this.log = deps.log;
    this.registerListeners();
  }

  /** Re-point the send/log callbacks at the current React closures (singleton reuse). */
  updateDeps(deps: BridgeDeps): void {
    this.send = deps.send;
    this.log = deps.log;
  }

  // -------------------------------------------------------------------------
  // Native listeners
  // -------------------------------------------------------------------------

  private registerListeners(): void {
    this.subscriptions = [
      Gatt.addDeviceConnectedListener(({ deviceId, name }) => {
        this.centrals.add(deviceId);
        this.log.info(`central connected: ${name ?? deviceId}`);
        this.send({ type: 'connected' });
      }),
      Gatt.addDeviceDisconnectedListener(({ deviceId }) => {
        this.centrals.delete(deviceId);
        this.dropPendingReadsFor(deviceId);
        this.log.info(`central disconnected: ${deviceId}`);
        this.send({ type: 'disconnected' });
      }),
      Gatt.addCharacteristicReadRequestListener((ev) => {
        const { deviceId, requestId, serviceUuid, characteristicUuid, offset } = ev;
        if (!this.isKnownChar(serviceUuid, characteristicUuid)) {
          this.log.warn(`read for unknown char ${serviceUuid}/${characteristicUuid}`);
          this.send({ type: 'schema-mismatch' });
          void Gatt.sendResponse(deviceId, requestId, GATT_SUCCESS, offset, []).catch(() => {});
          return;
        }
        // Store the pending read so a later `respond-to-read` can answer it.
        const key = charKey(serviceUuid, characteristicUuid);
        const list = this.pendingReads.get(key) ?? [];
        list.push({ deviceId, requestId, offset });
        this.pendingReads.set(key, list);
        this.send({ type: 'char-read', serviceUuid, charUuid: characteristicUuid });
      }),
      Gatt.addCharacteristicWriteRequestListener((ev) => {
        const { deviceId, requestId, serviceUuid, characteristicUuid, offset, value, responseNeeded } = ev;
        if (!this.isKnownChar(serviceUuid, characteristicUuid)) {
          this.log.warn(`write for unknown char ${serviceUuid}/${characteristicUuid}`);
          this.send({ type: 'schema-mismatch' });
        } else {
          this.send({ type: 'char-write', serviceUuid, charUuid: characteristicUuid, data: value });
        }
        if (responseNeeded) {
          void Gatt.sendResponse(deviceId, requestId, GATT_SUCCESS, offset, []).catch((err) => {
            this.emitError(`sendResponse (write ack) failed: ${errorMessageOf(err)}`);
          });
        }
      }),
      Gatt.addNotificationSentListener(({ characteristicUuid, status }) => {
        if (status !== GATT_SUCCESS) {
          this.log.warn(`notification for ${characteristicUuid} failed (status ${status})`);
        }
      }),
    ];
  }

  // -------------------------------------------------------------------------
  // Command handling (desktop -> phone)
  // -------------------------------------------------------------------------

  async handleCommand(cmd: PluginCommand): Promise<void> {
    try {
      switch (cmd.type) {
        case 'upload-schema':
          await this.onUploadSchema(cmd.schema, cmd.settings);
          break;
        case 'connect':
          await this.onConnect();
          break;
        case 'disconnect':
          this.onDisconnect();
          break;
        case 'notify':
          await this.onNotify(cmd.serviceUuid, cmd.charUuid, cmd.data);
          break;
        case 'respond-to-read':
          await this.onRespondToRead(cmd.serviceUuid, cmd.charUuid, cmd.data);
          break;
        default: {
          const _exhaustive: never = cmd;
          void _exhaustive;
        }
      }
    } catch (err) {
      // Never crash the RN app: surface everything as an error event + log.
      this.emitError(errorMessageOf(err));
    }
  }

  private async onUploadSchema(schema: Schema, settings: DeviceSettings): Promise<void> {
    // Reset any previous session before building the new server.
    this.stopServerSafely();
    this.schema = schema;
    this.settings = settings;
    this.rebuildKnownChars();
    this.advError = null;

    // Runtime BLE permissions (Android 12+) — without these the native module
    // rejects createServer/startAdvertising and the phone can't advertise at all.
    try {
      await ensureBlePermissions();
    } catch (err) {
      this.emitAdvFailed('permission', err);
      return;
    }

    const services = mapSchemaToGatt(schema);

    try {
      this.log.info(`upload-schema: ${services.length} service(s), device "${settings.deviceName}"`);
      await Gatt.createServer(services);
    } catch (err) {
      this.emitAdvFailed('create', err);
      return;
    }

    try {
      await Gatt.startAdvertising({
        localName: settings.deviceName,
        serviceUuids: services.map((s) => s.uuid),
      });
      this.advertising = true;
      this.advError = null;
      this.log.info(`advertising as "${settings.deviceName}"`);
      this.send({ type: 'adv-started' });
    } catch (err) {
      this.advertising = false;
      this.emitAdvFailed('advertise', err);
    }
  }

  private async onConnect(): Promise<void> {
    // Mirror the old backend: `connect` (re)starts advertising for the loaded
    // schema. Without a schema there is nothing to advertise.
    if (!this.schema || !this.settings) {
      this.emitError('connect: no schema loaded');
      return;
    }
    this.advError = null;
    try {
      await ensureBlePermissions();
    } catch (err) {
      this.emitAdvFailed('permission', err);
      return;
    }
    try {
      await Gatt.startAdvertising({
        localName: this.settings.deviceName,
        serviceUuids: this.schema.services.map((s) => s.uuid),
      });
      this.advertising = true;
      this.advError = null;
      this.log.info('advertising (re)started');
      this.send({ type: 'adv-started' });
    } catch (err) {
      this.advertising = false;
      this.emitAdvFailed('advertise', err);
    }
  }

  /**
   * Re-request permissions and restart advertising for the loaded schema.
   * Exposed for the UI's "retry" action after a surfaced advertise failure.
   */
  async retryAdvertising(): Promise<void> {
    await this.onConnect();
  }

  private onDisconnect(): void {
    this.stopServerSafely();
    this.send({ type: 'disconnected' });
  }

  private async onNotify(serviceUuid: string, charUuid: string, data: number[]): Promise<void> {
    if (!this.isKnownChar(serviceUuid, charUuid)) {
      this.log.warn(`notify for unknown char ${serviceUuid}/${charUuid}`);
      this.send({ type: 'schema-mismatch' });
      return;
    }
    // Keep the local characteristic value in sync for future reads.
    this.updateValueSafely(serviceUuid, charUuid, data);

    const centrals = [...this.centrals];
    if (centrals.length === 0) {
      this.log.warn(`notify ${charUuid}: no connected centrals`);
      return;
    }
    for (const deviceId of centrals) {
      try {
        // Fire-and-forget: desktop drives notify timing, so don't gate on CCCD subscription.
        await Gatt.sendNotification(deviceId, serviceUuid, charUuid, data, {
          requireSubscription: false,
        });
      } catch (err) {
        this.emitError(`sendNotification to ${deviceId} failed: ${errorMessageOf(err)}`);
      }
    }
  }

  private async onRespondToRead(serviceUuid: string, charUuid: string, data: number[]): Promise<void> {
    if (!this.isKnownChar(serviceUuid, charUuid)) {
      this.log.warn(`respond-to-read for unknown char ${serviceUuid}/${charUuid}`);
      this.send({ type: 'schema-mismatch' });
      return;
    }
    // Always keep the stored value current.
    this.updateValueSafely(serviceUuid, charUuid, data);

    const key = charKey(serviceUuid, charUuid);
    const list = this.pendingReads.get(key);
    const pending = list?.pop(); // newest pending read
    if (list && list.length === 0) this.pendingReads.delete(key);

    if (!pending) {
      this.log.warn(`respond-to-read ${charUuid}: no pending read, value stored`);
      return;
    }
    try {
      await Gatt.sendResponse(pending.deviceId, pending.requestId, GATT_SUCCESS, pending.offset, data);
    } catch (err) {
      this.emitError(`sendResponse (read) failed: ${errorMessageOf(err)}`);
    }
  }

  // -------------------------------------------------------------------------
  // Introspection / lifecycle
  // -------------------------------------------------------------------------

  /** Local mirror — synchronous, may lag native reality. Prefer `getLiveState()` for the UI. */
  getState(): BridgeState {
    return {
      advertising: this.advertising,
      advError: this.advError,
      deviceName: this.settings?.deviceName,
      serviceCount: this.schema?.services.length ?? 0,
      centrals: [...this.centrals],
    };
  }

  /**
   * Ground-truth state, queried from the native module so the UI can't drift from
   * reality (e.g. the radio still advertising after a JS reload). `advertising` and
   * `centrals` come from the native GATT server; `deviceName`/`serviceCount` are
   * schema-derived (the native side exposes no query for them). Native queries that
   * throw fall back to the local mirror rather than lying with a default.
   */
  async getLiveState(): Promise<BridgeState> {
    let advertising = this.advertising;
    let centrals = [...this.centrals];

    try {
      advertising = await Gatt.isAdvertising();
      this.advertising = advertising;
    } catch {
      /* keep mirror */
    }

    try {
      const devices = await Gatt.getConnectedDevices();
      centrals = devices.map((d) => d.deviceId);
      // Reconcile the mirror so notify() targets the centrals that are really connected.
      this.centrals.clear();
      for (const id of centrals) this.centrals.add(id);
    } catch {
      /* keep mirror */
    }

    return {
      advertising,
      advError: this.advError,
      deviceName: this.settings?.deviceName,
      serviceCount: this.schema?.services.length ?? 0,
      centrals,
    };
  }

  teardown(): void {
    for (const sub of this.subscriptions) {
      try {
        sub.remove();
      } catch {
        /* ignore */
      }
    }
    this.subscriptions = [];
    this.stopServerSafely();
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private rebuildKnownChars(): void {
    this.knownChars.clear();
    if (!this.schema) return;
    for (const svc of this.schema.services) {
      for (const chr of svc.characteristics) {
        this.knownChars.add(charKey(svc.uuid, chr.uuid));
      }
    }
  }

  private isKnownChar(serviceUuid: string, charUuid: string): boolean {
    return this.knownChars.has(charKey(serviceUuid, charUuid));
  }

  private dropPendingReadsFor(deviceId: string): void {
    for (const [key, list] of this.pendingReads) {
      const filtered = list.filter((r) => r.deviceId !== deviceId);
      if (filtered.length === 0) this.pendingReads.delete(key);
      else this.pendingReads.set(key, filtered);
    }
  }

  // Run a native GATT call, folding both synchronous throws and async rejections into a
  // single log line. Several expo-gatt-server calls became async (a85732d), so an
  // unguarded rejection would otherwise become an unhandled promise rejection.
  private settleGatt(label: string, call: () => unknown): void {
    try {
      const result = call();
      if (result && typeof (result as Promise<void>).catch === 'function') {
        void (result as Promise<void>).catch((err) => {
          this.log.warn(`${label} failed: ${errorMessageOf(err)}`);
        });
      }
    } catch (err) {
      this.log.warn(`${label} failed: ${errorMessageOf(err)}`);
    }
  }

  private updateValueSafely(serviceUuid: string, charUuid: string, data: number[]): void {
    this.settleGatt('updateCharacteristicValue', () =>
      Gatt.updateCharacteristicValue(serviceUuid, charUuid, data),
    );
  }

  private stopServerSafely(): void {
    this.settleGatt('stopAdvertising', () => Gatt.stopAdvertising());
    this.settleGatt('stopServer', () => Gatt.stopServer());
    this.advertising = false;
    this.centrals.clear();
    this.pendingReads.clear();
  }

  private emitError(message: string): void {
    this.log.error(message);
    this.send({ type: 'error', message });
  }

  private emitAdvFailed(stage: string, err: unknown): void {
    const message = errorMessageOf(err);
    this.advertising = false;
    this.advError = `${stage}: ${message}`;
    this.log.error(`adv-failed (${stage}): ${message}`);
    this.send({ type: 'error', message });
    this.send({ type: 'adv-failed', stage, errorCode: errorCodeOf(err) });
  }
}

// One native GATT server exists per app, so the bridge is a process-wide singleton.
// This keeps the published schema (and thus the advertised device name / service count)
// alive across JS reloads and screen re-mounts instead of resetting to an empty state
// while the radio is still advertising.
let singleton: GattBridge | null = null;

export function createGattBridge(deps: BridgeDeps): GattBridge {
  if (singleton) {
    singleton.updateDeps(deps);
    return singleton;
  }
  singleton = new GattBridge(deps);
  return singleton;
}
