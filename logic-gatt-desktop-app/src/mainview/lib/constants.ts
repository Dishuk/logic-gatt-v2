/**
 * Shared constants for BLE schema limits and advertising constraints.
 * These apply across all transport plugins (ble-uart plugin constraints are the most restrictive).
 */

// BLE advertising packet constraints
// Total advertising packet: 31 bytes max
// Fixed overhead: Flags (3) + TX Power (3) = 6 bytes
// Remaining: 25 bytes for name + appearance + UUIDs + mfr data
export const BLE_ADV_PACKET_MAX = 31
const BLE_ADV_FIXED_OVERHEAD = 6 // Flags (3) + TX Power (3)
const BLE_ADV_FIELD_HEADER = 2 // Each field has 1-byte length + 1-byte type

// BLE advertising limits (conservative defaults)
// Name limit assumes worst case: appearance (4) + 2 UUIDs (6) = 10 bytes used
// Available: 31 - 6 - 10 = 15 bytes, minus 2 header = 13 bytes for name
// Using 16 as a reasonable middle ground that works in most cases
export const MAX_DEVICE_NAME_BYTES = 16
export const MAX_MANUFACTURER_DATA_BYTES = 16

// Schema limits
export const MAX_SERVICES = 8
export const MAX_CHARS_PER_SERVICE = 16

/**
 * Calculate total BLE advertising packet size.
 * Returns the number of bytes needed for the advertising packet.
 */
export function calculateAdvPacketSize(
  deviceNameBytes: number,
  appearance: number,
  manufacturerDataBytes: number,
  numUuids: number
): number {
  let size = BLE_ADV_FIXED_OVERHEAD

  // Name field: header (2) + name bytes
  size += BLE_ADV_FIELD_HEADER + deviceNameBytes

  // Appearance: header (2) + 2 bytes data (only if non-zero)
  if (appearance !== 0) {
    size += BLE_ADV_FIELD_HEADER + 2
  }

  // Manufacturer data: header (2) + data (only if present)
  if (manufacturerDataBytes > 0) {
    size += BLE_ADV_FIELD_HEADER + manufacturerDataBytes
  }

  // 16-bit UUIDs: header (2) + 2 bytes per UUID (only if present)
  if (numUuids > 0) {
    size += BLE_ADV_FIELD_HEADER + numUuids * 2
  }

  return size
}
