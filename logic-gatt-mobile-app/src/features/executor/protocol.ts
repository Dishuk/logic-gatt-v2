/**
 * Wire protocol for the BLE executor.
 *
 * The phone is a *dumb relay*: the desktop app holds all scenario logic and
 * sends `PluginCommand`s over the WebSocket; the phone executes them against the
 * `expo-gatt-server` native module and relays `PluginEvent`s back.
 *
 * These types mirror the desktop's `src/shared/wire.ts` exactly so both ends
 * agree. Binary GATT values are `number[]` on the wire (JSON-serializable).
 */

import type {
  GattServiceConfig,
  CharacteristicProperty,
  CharacteristicPermission,
} from 'expo-gatt-server';

// --- GATT schema (wire format) ---

export interface CharacteristicProperties {
  read: boolean;
  write: boolean;
  notify: boolean;
}

export interface CharacteristicDef {
  uuid: string;
  name?: string;
  properties: CharacteristicProperties;
  defaultValue?: number[];
}

export interface ServiceDef {
  uuid: string;
  name?: string;
  characteristics: CharacteristicDef[];
}

export interface Schema {
  services: ServiceDef[];
}

export interface DeviceSettings {
  deviceName: string;
  appearance?: number;
  manufacturerData?: number[];
  serviceUuids16Bit?: string[];
}

// --- phone -> desktop events ---

export type PluginEvent =
  | { type: 'char-write'; serviceUuid: string; charUuid: string; data: number[] }
  | { type: 'char-read'; serviceUuid: string; charUuid: string }
  | { type: 'connected' }
  | { type: 'disconnected'; reason?: string }
  | { type: 'error'; message: string }
  | { type: 'log'; message: string }
  | { type: 'schema-mismatch' }
  | { type: 'adv-started' }
  | { type: 'adv-failed'; stage: string; errorCode: number };

// --- desktop -> phone commands ---

export type PluginCommand =
  | { type: 'upload-schema'; schema: Schema; settings: DeviceSettings }
  | { type: 'connect' }
  | { type: 'disconnect' }
  | { type: 'notify'; serviceUuid: string; charUuid: string; data: number[] }
  | { type: 'respond-to-read'; serviceUuid: string; charUuid: string; data: number[] };

// --- liveness ping/pong (kept from the previous connection milestone) ---

export interface PingMessage {
  type: 'ping';
  seq: number;
  t: number;
}

export interface PongMessage {
  type: 'pong';
  seq: number;
  t: number;
}

// ---------------------------------------------------------------------------
// Schema mapping: wire `Schema` -> expo-gatt-server `GattServiceConfig[]`
// ---------------------------------------------------------------------------

function mapCharProperties(p: CharacteristicProperties): CharacteristicProperty[] {
  const props: CharacteristicProperty[] = [];
  if (p.read) props.push('read');
  if (p.write) props.push('write');
  if (p.notify) props.push('notify');
  return props;
}

function mapCharPermissions(p: CharacteristicProperties): CharacteristicPermission[] {
  const perms: CharacteristicPermission[] = [];
  if (p.read) perms.push('readable');
  if (p.write) perms.push('writeable');
  return perms;
}

/** Map the wire schema to the native module's service-config shape. */
export function mapSchemaToGatt(schema: Schema): GattServiceConfig[] {
  return schema.services.map((svc) => ({
    uuid: svc.uuid,
    characteristics: svc.characteristics.map((chr) => ({
      uuid: chr.uuid,
      properties: mapCharProperties(chr.properties),
      permissions: mapCharPermissions(chr.properties),
      ...(chr.defaultValue !== undefined ? { value: chr.defaultValue } : {}),
      // Always delegate reads on readable chars to JS: the desktop computes a fresh value
      // per read from the current variables. Without this the native server auto-answers
      // from its last stored value and serves stale data after a UI/variable change. The
      // desktop guarantees a response to every delegated read (scenario, else defaultValue).
      ...(chr.properties.read ? { delegate: { read: true } } : {}),
    })),
  }));
}

// ---------------------------------------------------------------------------
// Parsing / guards for incoming socket messages
// ---------------------------------------------------------------------------

const COMMAND_TYPES = new Set([
  'upload-schema',
  'connect',
  'disconnect',
  'notify',
  'respond-to-read',
]);

function isNumberArray(v: unknown): v is number[] {
  return Array.isArray(v) && v.every((n) => typeof n === 'number');
}

/**
 * Best-effort guard that a parsed object is a well-formed `PluginCommand`.
 * Returns the typed command or `null` if it does not match the contract.
 */
export function isPluginCommand(msg: unknown): msg is PluginCommand {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  if (typeof m.type !== 'string' || !COMMAND_TYPES.has(m.type)) return false;

  switch (m.type) {
    case 'connect':
    case 'disconnect':
      return true;
    case 'upload-schema':
      return typeof m.schema === 'object' && m.schema !== null &&
        typeof m.settings === 'object' && m.settings !== null;
    case 'notify':
    case 'respond-to-read':
      return typeof m.serviceUuid === 'string' &&
        typeof m.charUuid === 'string' &&
        isNumberArray(m.data);
    default:
      return false;
  }
}

/** Parse a raw socket string into a `PluginCommand`, or `null` if it isn't one. */
export function parseCommand(raw: string): PluginCommand | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isPluginCommand(parsed) ? parsed : null;
}

/** True if the parsed message is a liveness ping. */
export function isPing(msg: unknown): msg is PingMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as { type?: unknown }).type === 'ping'
  );
}
