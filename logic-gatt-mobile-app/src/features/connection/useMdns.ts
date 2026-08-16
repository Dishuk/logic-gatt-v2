import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Zeroconf from 'react-native-zeroconf';

import { createLogger, errorMessage, type LogSink } from '@/lib/logger';

export interface MdnsService {
  name: string;
  host?: string;
  port?: number;
  url: string;
}

/** Resolved-service shape from react-native-zeroconf (typed loosely). */
interface ResolvedService {
  name: string;
  host?: string;
  port?: number;
  addresses?: string[];
  txt?: Record<string, string>;
}

/**
 * Browse the LAN for the desktop's `_logicgatt._tcp` service. The desktop puts its
 * `ws://` URL in the TXT record; fall back to building it from address + port.
 */
export function useMdns(sink: LogSink) {
  const log = useMemo(() => createLogger('mdns', sink), [sink]);
  const zeroconfRef = useRef<Zeroconf | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [services, setServices] = useState<MdnsService[]>([]);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    const zc = new Zeroconf();
    zeroconfRef.current = zc;

    zc.on('resolved', (raw: unknown) => {
      const s = raw as ResolvedService;
      const addr = (s.addresses ?? []).find((a) => a.includes('.')) ?? s.host;
      const url = s.txt?.url ?? (addr && s.port ? `ws://${addr}:${s.port}` : null);
      if (!url) return;
      setServices((prev) => {
        if (prev.some((p) => p.url === url)) return prev;
        log.info(`found ${s.name} @ ${url}`);
        return [...prev, { name: s.name, host: addr, port: s.port, url }];
      });
    });
    zc.on('error', (err: unknown) => log.error(`mDNS error: ${errorMessage(err)}`));

    return () => {
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
      try {
        zc.stop();
        (zc as unknown as { removeDeviceListeners?: () => void }).removeDeviceListeners?.();
      } catch {
        /* ignore */
      }
    };
  }, [log]);

  const scan = useCallback(() => {
    // Clear any prior scan's stop-timer so overlapping scans can't stop each other early.
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    setServices([]);
    setScanning(true);
    log.info('scanning mDNS (_logicgatt._tcp)…');
    try {
      zeroconfRef.current?.scan('logicgatt', 'tcp', 'local.');
    } catch (err) {
      log.error(`scan failed: ${errorMessage(err)}`);
    }
    stopTimerRef.current = setTimeout(() => {
      stopTimerRef.current = null;
      try {
        zeroconfRef.current?.stop();
      } catch {
        /* ignore */
      }
      setScanning(false);
    }, 8000);
  }, [log]);

  return { services, scanning, scan };
}
