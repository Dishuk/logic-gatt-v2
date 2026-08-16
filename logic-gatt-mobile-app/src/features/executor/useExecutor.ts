import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { createLogger, errorMessage, type LogSink } from '@/lib/logger';

import { createGattBridge, type BridgeState, type GattBridge } from './gattBridge';
import { ensureBlePermissions } from './permissions';
import { isPing, parseCommand, type PluginEvent } from './protocol';

export type WsStatus = 'idle' | 'connecting' | 'connected' | 'error';

const PING_INTERVAL_MS = 2000;

const EMPTY_STATE: BridgeState = {
  advertising: false,
  advError: null,
  serviceCount: 0,
  centrals: [],
};

/**
 * Owns the WebSocket to the desktop and the GATT bridge. Routes incoming
 * messages (ping/pong + `PluginCommand` -> bridge), relays `PluginEvent`s back
 * up the socket, keeps the 2s liveness ping, and exposes status + executor
 * state for the UI. The phone runs no scenario logic — it just relays.
 */
export function useExecutor(sink: LogSink) {
  const [status, setStatus] = useState<WsStatus>('idle');
  const [url, setUrl] = useState<string | null>(null);
  const [exec, setExec] = useState<BridgeState>(EMPTY_STATE);

  const wsRef = useRef<WebSocket | null>(null);
  const bridgeRef = useRef<GattBridge | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const seqRef = useRef(0);

  // WebSocket/transport lines (console + UI panel, not mirrored to desktop).
  const log = useMemo(() => createLogger('ws', sink), [sink]);

  // Pull ground-truth state from the native module (advertising / connected centrals),
  // falling back to the synchronous mirror only if a native query throws.
  const refreshLive = useCallback(async () => {
    const b = bridgeRef.current;
    if (!b) {
      setExec(EMPTY_STATE);
      return;
    }
    try {
      setExec(await b.getLiveState());
    } catch {
      setExec(b.getState());
    }
  }, []);

  // Send a PluginEvent up the socket (no-op if the socket is not open).
  const sendEvent = useCallback((event: PluginEvent) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  }, []);

  // The bridge registers native GATT listeners; keep it alive for the whole
  // screen lifetime so the phone is always ready to act as a peripheral.
  useEffect(() => {
    // Bridge logger: UI panel + console (via createLogger) AND mirrored to the
    // desktop as a `log` event, matching the old backend's `ctx.log`. Built here
    // (not in render) so the sink is never read during render.
    const bridgeLog = createLogger('gatt', (entry) => {
      sink(entry);
      sendEvent({ type: 'log', message: entry.msg });
    });
    const bridge = createGattBridge({
      send: (event) => {
        sendEvent(event);
        void refreshLive();
      },
      log: bridgeLog,
    });
    bridgeRef.current = bridge;
    void refreshLive();
    // No teardown: the bridge is a process-wide singleton that must outlive screen
    // re-mounts / JS reloads so the phone keeps advertising and the UI keeps reading
    // the real native state.
  }, [sink, sendEvent, refreshLive]);

  // Poll native ground truth so the executor panel can't drift (e.g. show "off" while
  // the radio is advertising) even when no event arrives.
  useEffect(() => {
    void refreshLive();
    const id = setInterval(() => void refreshLive(), 1500);
    return () => clearInterval(id);
  }, [refreshLive]);

  const stopPing = useCallback(() => {
    if (pingRef.current) {
      clearInterval(pingRef.current);
      pingRef.current = null;
    }
  }, []);

  const sendPing = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const seq = ++seqRef.current;
    ws.send(JSON.stringify({ type: 'ping', seq, t: Date.now() }));
  }, []);

  const disconnect = useCallback(() => {
    stopPing();
    wsRef.current?.close();
    wsRef.current = null;
    setStatus('idle');
  }, [stopPing]);

  const connect = useCallback(
    (target: string) => {
      // Tear down any existing socket first. Detach its handlers before closing so a
      // late close/error from the old socket can't stop the new ping or reset status.
      stopPing();
      const prev = wsRef.current;
      if (prev) {
        prev.onopen = prev.onmessage = prev.onerror = prev.onclose = null;
        try {
          prev.close();
        } catch {
          /* ignore */
        }
      }
      seqRef.current = 0;
      setUrl(target);
      setStatus('connecting');
      log.info(`connecting ${target}`);

      // Prompt for BLE permission up front so it's granted before the desktop
      // pushes a schema. Best-effort — the bridge re-checks and surfaces failures.
      void ensureBlePermissions().catch((err) => log.warn(`ble permission: ${errorMessage(err)}`));

      const ws = new WebSocket(target);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus('connected');
        log.info('connected');
        pingRef.current = setInterval(() => sendPing(), PING_INTERVAL_MS);
        sendPing();
      };

      ws.onmessage = (e) => {
        const raw = String(e.data);
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          log.warn(`recv (unparseable) ${raw}`);
          return;
        }

        // Liveness: reply to desktop pings; measure round-trip on pong echoes.
        if (isPing(parsed)) {
          const p = parsed as { seq: number; t: number };
          ws.send(JSON.stringify({ type: 'pong', seq: p.seq, t: p.t }));
          return;
        }
        if ((parsed as { type?: unknown }).type === 'pong') {
          const p = parsed as { seq?: number; t?: number };
          if (typeof p.t === 'number') {
            const rtt = Date.now() - p.t;
            log.debug(`pong #${p.seq ?? '?'} rtt ${rtt}ms`);
            if (rtt > 1000) log.warn(`slow pong #${p.seq ?? '?'} (${rtt}ms)`);
          }
          return;
        }

        // PluginCommand -> bridge.
        const cmd = parseCommand(raw);
        if (cmd) {
          log.info(`cmd ${cmd.type}`);
          void bridgeRef.current?.handleCommand(cmd).then(() => refreshLive());
          return;
        }

        log.warn(`recv (ignored) ${raw}`);
      };

      ws.onerror = (e) => {
        setStatus('error');
        const reason = (e as unknown as { message?: string }).message;
        log.error(reason ? `ws error: ${reason}` : 'ws error');
      };

      ws.onclose = (e) => {
        stopPing();
        setStatus('idle');
        const ce = e as unknown as { code?: number; reason?: string };
        const detail = ce.code != null ? ` (${ce.code}${ce.reason ? ` ${ce.reason}` : ''})` : '';
        // 1000 = normal, 1005 = no status (clean local close); anything else is unexpected.
        const clean = ce.code == null || ce.code === 1000 || ce.code === 1005;
        (clean ? log.info : log.warn)(`closed${detail}`);
      };
    },
    [log, sendPing, stopPing, refreshLive],
  );

  // Re-request permissions and restart advertising for the loaded schema.
  const retryAdvertising = useCallback(async () => {
    await bridgeRef.current?.retryAdvertising();
    void refreshLive();
  }, [refreshLive]);

  return { status, url, exec, connect, disconnect, sendPing, retryAdvertising };
}
