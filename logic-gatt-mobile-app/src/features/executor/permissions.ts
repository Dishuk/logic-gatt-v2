import { PermissionsAndroid, Platform } from 'react-native';

/**
 * Request the runtime BLE permissions the peripheral needs on Android 12+ (API 31).
 *
 * `expo-gatt-server` declares these in its merged manifest, but ADVERTISE/CONNECT
 * must ALSO be granted at runtime or `createServer` / `startAdvertising` reject.
 * The module only *checks* them — requesting is the app's job.
 *
 * No-op on iOS (handled by the `NSBluetoothAlwaysUsageDescription` prompt inside
 * `createServer`) and on pre-31 Android (those permissions are install-time).
 *
 * Throws with a descriptive message if the user denies, so callers can surface it.
 */
export async function ensureBlePermissions(): Promise<void> {
  if (Platform.OS !== 'android') return;
  if (typeof Platform.Version !== 'number' || Platform.Version < 31) return;

  const result = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
  ]);

  const denied = Object.entries(result)
    .filter(([, status]) => status !== PermissionsAndroid.RESULTS.GRANTED)
    .map(([perm]) => perm.replace('android.permission.', ''));

  if (denied.length > 0) {
    throw new Error(
      `Bluetooth permission denied: ${denied.join(', ')}. Enable it in system settings, then retry.`,
    );
  }
}
