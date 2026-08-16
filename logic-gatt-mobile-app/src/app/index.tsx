import { CameraView, useCameraPermissions } from 'expo-camera';
import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { theme } from '@/constants/theme';
import { useMdns } from '@/features/connection/useMdns';
import { useExecutor } from '@/features/executor/useExecutor';
import { createLogger, formatLogTime, type LogEntry, type LogLevel, type LogSink } from '@/lib/logger';

// Single spacing system used everywhere so edges line up and rhythm is even.
const PAD = 12; // horizontal gutter + vertical padding for every block
const GAP = 8; // space between stacked items

const STATUS_COLOR: Record<string, string> = {
  idle: theme.textSecondary,
  connecting: theme.amber,
  connected: theme.greenBright,
  error: theme.red,
};

// Log-line color by severity (debug never reaches the panel; listed for completeness).
const LEVEL_COLOR: Record<LogLevel, string> = {
  debug: theme.textMuted,
  info: theme.textSecondary,
  warn: theme.amber,
  error: theme.red,
};

export default function ConnectScreen() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const sink = useCallback<LogSink>((e) => setEntries((l) => [e, ...l].slice(0, 200)), []);
  const clearLog = useCallback(() => setEntries([]), []);
  // The screen's own messages (QR / camera / url validation).
  const ui = useMemo(() => createLogger('app', sink), [sink]);

  const exec = useExecutor(sink);
  const mdns = useMdns(sink);
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);

  const handleUrl = useCallback(
    (raw: string) => {
      const url = raw.trim();
      if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
        ui.warn(`ignored (not a ws url): ${url}`);
        return;
      }
      exec.connect(url);
    },
    [exec, ui],
  );

  const openScanner = useCallback(async () => {
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) {
        ui.warn('camera permission denied');
        return;
      }
    }
    setScanning(true);
  }, [permission, requestPermission, ui]);

  const onBarcode = useCallback(
    (result: { data: string }) => {
      setScanning(false);
      ui.info(`scanned: ${result.data}`);
      handleUrl(result.data);
    },
    [handleUrl, ui],
  );

  const connected = exec.status === 'connected';
  const insets = useSafeAreaInsets();
  const hPad = { paddingLeft: PAD + insets.left, paddingRight: PAD + insets.right };

  if (scanning) {
    return (
      <View style={styles.fill}>
        <CameraView
          style={styles.fill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={onBarcode}
        />
        <SafeAreaView style={styles.scannerOverlay}>
          <Text style={styles.scannerHint}>Point at the desktop QR code</Text>
          <Pressable style={[styles.btn, styles.btnGhost]} onPress={() => setScanning(false)}>
            <Text style={styles.btnText}>Cancel</Text>
          </Pressable>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.topBar, hPad, { paddingTop: PAD + insets.top }]}>
        <Text style={styles.brand}>LogicGATT</Text>
        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: STATUS_COLOR[exec.status] }]} />
          <Text style={styles.statusText}>{exec.status}</Text>
        </View>
      </View>

      {/* Upper block — compact, content-sized. */}
      <View style={[styles.controls, hPad]}>
        {!connected ? (
          <>
            <Pressable style={[styles.btn, styles.btnPrimary]} onPress={openScanner}>
              <Text style={styles.btnText}>Scan QR code</Text>
            </Pressable>
            <Pressable style={styles.btn} onPress={mdns.scan} disabled={mdns.scanning}>
              <Text style={styles.btnText}>
                {mdns.scanning ? 'Scanning network…' : 'Find on network (mDNS)'}
              </Text>
            </Pressable>
            {mdns.services.map((s) => (
              <Pressable key={s.url} style={styles.serviceItem} onPress={() => handleUrl(s.url)}>
                <Text style={styles.serviceName}>{s.name}</Text>
                <Text style={styles.serviceUrl}>{s.url}</Text>
              </Pressable>
            ))}
          </>
        ) : (
          <>
            {exec.exec.advError ? (
              <View style={styles.advErrorBox}>
                <Text style={styles.advErrorTitle}>Advertising failed</Text>
                <Text style={styles.advErrorText}>{exec.exec.advError}</Text>
                <Pressable style={[styles.btn, styles.btnError]} onPress={exec.retryAdvertising}>
                  <Text style={styles.btnText}>Grant permission & retry</Text>
                </Pressable>
              </View>
            ) : null}

            <View style={styles.execGrid}>
              <ExecRow label="Endpoint" first>
                <Text style={styles.execValue} numberOfLines={1}>
                  {exec.url ?? '—'}
                </Text>
              </ExecRow>
              <ExecRow label="Advertising">
                <View
                  style={[
                    styles.dot,
                    { backgroundColor: exec.exec.advertising ? theme.greenBright : theme.textMuted },
                  ]}
                />
                <Text style={styles.execValue}>{exec.exec.advertising ? 'on' : 'off'}</Text>
              </ExecRow>
              <ExecRow label="Device name">
                <Text style={styles.execValue}>{exec.exec.deviceName ?? '—'}</Text>
              </ExecRow>
              <ExecRow label="Services">
                <Text style={styles.execValue}>{exec.exec.serviceCount}</Text>
              </ExecRow>
              <ExecRow label="Centrals">
                <Text style={styles.execValue}>{exec.exec.centrals.length}</Text>
              </ExecRow>
            </View>

            <Pressable style={[styles.btn, styles.btnError]} onPress={exec.disconnect}>
              <Text style={styles.btnText}>Disconnect</Text>
            </Pressable>
          </>
        )}
      </View>

      {/* Lower block — fills remaining height; bottom inset padding keeps the scroll
          viewport above the nav bar while the dark background still bleeds to the edge. */}
      <View style={[styles.logBlock, { paddingBottom: insets.bottom }]}>
        <View style={[styles.logHeader, hPad]}>
          <Text style={styles.panelHeaderText}>Log</Text>
          <Pressable
            onPress={clearLog}
            disabled={entries.length === 0}
            hitSlop={10}
            accessibilityLabel="Clear log"
            style={({ pressed }) => [
              styles.clearBtn,
              pressed && styles.clearBtnPressed,
              entries.length === 0 && styles.clearBtnDisabled,
            ]}>
            <TrashIcon color={theme.textSecondary} size={15} />
          </Pressable>
        </View>
        <ScrollView style={styles.fill} contentContainerStyle={[styles.logContent, hPad]}>
          {entries.length === 0 ? (
            <Text style={styles.logEmpty}>no activity yet</Text>
          ) : (
            entries.map((e, i) => (
              <Text key={i} style={[styles.logLine, { color: LEVEL_COLOR[e.level] }]}>
                <Text style={styles.logTime}>{formatLogTime(e.ts)}</Text>
                {`  [${e.tag}] ${e.msg}`}
              </Text>
            ))
          )}
        </ScrollView>
      </View>
    </View>
  );
}

/** Small monochrome trash-can icon drawn from primitives (no icon dependency). */
function TrashIcon({ color, size = 15 }: { color: string; size?: number }) {
  const bar = { backgroundColor: color, height: 2, borderRadius: 1 };
  return (
    <View style={{ width: size, alignItems: 'center' }}>
      <View style={[bar, { width: size * 0.36 }]} />
      <View style={[bar, { width: size, marginTop: 1.5 }]} />
      <View
        style={{
          width: size * 0.74,
          height: size * 0.64,
          marginTop: 2,
          borderColor: color,
          borderWidth: 1.5,
          borderTopWidth: 0,
          borderBottomLeftRadius: 2,
          borderBottomRightRadius: 2,
          flexDirection: 'row',
          justifyContent: 'space-evenly',
          paddingTop: 2,
        }}>
        <View style={{ width: 1.5, height: '68%', backgroundColor: color }} />
        <View style={{ width: 1.5, height: '68%', backgroundColor: color }} />
      </View>
    </View>
  );
}

function ExecRow({
  label,
  first,
  children,
}: {
  label: string;
  first?: boolean;
  children: ReactNode;
}) {
  return (
    <View style={[styles.execRow, !first && styles.execRowDivider]}>
      <Text style={styles.execLabel}>{label}</Text>
      <View style={styles.execValueRow}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  container: { flex: 1, backgroundColor: theme.bgBody },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: PAD, // paddingTop / horizontal come from the safe-area insets
    backgroundColor: theme.bgTopbar,
    borderBottomWidth: 1,
    borderBottomColor: theme.borderTopbar,
  },
  brand: { fontSize: 16, fontWeight: '700', color: theme.textPrimary, letterSpacing: 0.3 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: GAP },
  dot: { width: 9, height: 9, borderRadius: 5 },
  statusText: { color: theme.textSecondary, fontFamily: 'monospace', fontSize: 12 },

  // Upper block — content-sized, one gutter, even gaps. Horizontal padding from insets.
  controls: {
    paddingVertical: PAD,
    gap: GAP,
    borderBottomWidth: 1,
    borderBottomColor: theme.borderPrimary,
  },

  // Buttons (full width via column stretch)
  btn: {
    backgroundColor: theme.bgButton,
    borderWidth: 1,
    borderColor: theme.bgTopbar,
    paddingVertical: PAD,
    paddingHorizontal: PAD,
    borderRadius: 4,
    alignItems: 'center',
  },
  btnPrimary: { backgroundColor: theme.bgButtonHover, borderColor: theme.accentBlue },
  btnGhost: { backgroundColor: theme.bgDark },
  btnError: { backgroundColor: theme.bgErrorBtn, borderColor: theme.borderError },
  btnText: { color: theme.textPrimary, fontWeight: '600', fontSize: 14 },

  execGrid: {
    borderWidth: 1,
    borderColor: theme.borderPrimary,
    borderRadius: 6,
    overflow: 'hidden',
  },
  execRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: PAD,
    paddingHorizontal: PAD,
    paddingVertical: 10,
    backgroundColor: theme.bgDarkest,
  },
  execRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.borderPrimary },
  execLabel: { color: theme.textSecondary, fontSize: 13 },
  execValueRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  execValue: { color: theme.textPrimary, fontWeight: '600', fontSize: 13, fontFamily: 'monospace' },

  serviceItem: {
    paddingHorizontal: PAD,
    paddingVertical: 10,
    backgroundColor: theme.bgDarkest,
    borderWidth: 1,
    borderColor: theme.borderPrimary,
    borderRadius: 6,
  },
  serviceName: { color: theme.textPrimary, fontWeight: '600', fontSize: 14 },
  serviceUrl: { color: theme.accentBlue, fontFamily: 'monospace', fontSize: 12 },

  advErrorBox: {
    backgroundColor: theme.bgError,
    borderColor: theme.borderError,
    borderWidth: 1,
    borderRadius: 6,
    padding: PAD,
    gap: GAP,
  },
  advErrorTitle: { color: theme.redLight, fontWeight: '700', fontSize: 14 },
  advErrorText: { color: theme.textContent, fontSize: 13, fontFamily: 'monospace' },

  // Lower block — fills all remaining height.
  logBlock: { flex: 1, backgroundColor: theme.bgDarkest },
  logHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.bgDark,
    paddingVertical: GAP,
    borderBottomWidth: 1,
    borderBottomColor: theme.borderPrimary,
  },
  panelHeaderText: {
    color: theme.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  clearBtn: { padding: 4, borderRadius: 4 },
  clearBtnPressed: { backgroundColor: theme.bgButton },
  clearBtnDisabled: { opacity: 0.35 },
  logContent: { paddingVertical: PAD, gap: 3 },
  logEmpty: { color: theme.textMuted, fontFamily: 'monospace', fontSize: 12 },
  logLine: { color: theme.textSecondary, fontFamily: 'monospace', fontSize: 12 },
  logTime: { color: theme.textMuted },

  scannerOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    top: 0,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 40,
  },
  scannerHint: {
    color: theme.textPrimary,
    fontSize: 16,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: PAD,
    paddingVertical: 6,
    borderRadius: 6,
  },
});
