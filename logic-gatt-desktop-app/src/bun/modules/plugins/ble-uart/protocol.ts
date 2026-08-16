/**
 * BLE UART protocol implementation.
 * Protocol: [0xAA] [CMD] [LEN] [PAYLOAD...] [CRC8]
 */

export const START_BYTE = 0xaa

// Schema commands
export const CMD_ADD_SERVICE = 0x01
export const CMD_ADD_CHAR = 0x02
export const CMD_APPLY_SCHEMA = 0x03
export const CMD_SET_DEVICE_NAME = 0x04
export const CMD_SET_ADV_DATA = 0x05
export const CMD_SET_ADV_UUIDS = 0x06
export const CMD_ACK = 0x10
export const CMD_NACK = 0x11

// Runtime commands
export const CMD_CHAR_WRITE_EVENT = 0x20
export const CMD_CHAR_READ_EVENT = 0x21
export const CMD_NOTIFY_CMD = 0x22
export const CMD_READ_RESPONSE = 0x23

// Heartbeat
export const CMD_PING = 0x30
export const CMD_PONG = 0x31

// Status events (device -> frontend)
export const CMD_ADV_STARTED = 0x32
export const CMD_ADV_FAILED = 0x33

export const BAUD_RATE = 115200

// BLE advertising limits (conservative to fit in 31-byte packet)
export const MAX_DEVICE_NAME_BYTES = 16
export const MAX_MANUFACTURER_DATA_BYTES = 16
export const MAX_ADVERTISED_UUIDS = 2

/** CRC-8 polynomial 0x31, init 0x00 */
export function crc8(data: Uint8Array): number {
  let crc = 0x00
  for (const byte of data) {
    crc ^= byte
    for (let i = 0; i < 8; i++) {
      if (crc & 0x80) {
        crc = ((crc << 1) ^ 0x31) & 0xff
      } else {
        crc = (crc << 1) & 0xff
      }
    }
  }
  return crc
}

export function buildFrame(cmd: number, payload: Uint8Array = new Uint8Array()): Uint8Array {
  const len = payload.length
  const crcData = new Uint8Array([cmd, len, ...payload])
  const crc = crc8(crcData)
  return new Uint8Array([START_BYTE, cmd, len, ...payload, crc])
}

/**
 * Convert a UUID string to a 16-byte little-endian array.
 */
export function uuidStrToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '')
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16)
  }
  bytes.reverse() // Little-endian for BLE
  return bytes
}

/**
 * Extract 16-bit UUID from a full 128-bit UUID if it's a standard Bluetooth UUID.
 */
export function extractShortUuid(uuid: string): number | null {
  const normalized = uuid.toLowerCase()
  if (normalized.match(/^0000[0-9a-f]{4}-0000-1000-8000-00805f9b34fb$/)) {
    return parseInt(normalized.substring(4, 8), 16)
  }
  return null
}

/**
 * Parse a hex string (space-separated bytes) into a Uint8Array.
 */
export function hexStringToBytes(hex: string): Uint8Array {
  const tokens = hex.trim().split(/\s+/).filter(Boolean)
  return new Uint8Array(tokens.map((t) => parseInt(t, 16)))
}

/**
 * Compute a 4-byte schema hash from service/characteristic UUIDs and properties.
 */
export function computeSchemaHash(
  schema: {
    uuid: string
    characteristics: { uuid: string; properties: { read: boolean; write: boolean; notify: boolean } }[]
  }[]
): Uint8Array {
  const parts: number[] = []
  for (const svc of schema) {
    parts.push(...uuidStrToBytes(svc.uuid))
    for (const chr of svc.characteristics) {
      parts.push(...uuidStrToBytes(chr.uuid))
      const props =
        (chr.properties.read ? 0x01 : 0) | (chr.properties.write ? 0x02 : 0) | (chr.properties.notify ? 0x04 : 0)
      parts.push(props)
    }
  }

  // Compute hash using multiple CRC8 rounds
  const data = new Uint8Array(parts)
  const hash = new Uint8Array(4)
  const chunkSize = Math.ceil(data.length / 4)
  for (let i = 0; i < 4; i++) {
    const start = i * chunkSize
    const end = Math.min(start + chunkSize, data.length)
    const chunk = data.slice(start, end)
    hash[i] = chunk.length > 0 ? crc8(chunk) : 0
  }

  return hash
}

export function buildSetDeviceNameFrame(name: string): Uint8Array {
  const encoder = new TextEncoder()
  const nameBytes = encoder.encode(name)
  if (nameBytes.length > MAX_DEVICE_NAME_BYTES) {
    throw new Error(`Device name too long: ${nameBytes.length} bytes (max ${MAX_DEVICE_NAME_BYTES})`)
  }
  return buildFrame(CMD_SET_DEVICE_NAME, nameBytes)
}

export function buildSetAdvDataFrame(appearance: number, manufacturerData?: Uint8Array): Uint8Array {
  const mfrLen = manufacturerData?.length ?? 0
  if (mfrLen > MAX_MANUFACTURER_DATA_BYTES) {
    throw new Error(`Manufacturer data too long: ${mfrLen} bytes (max ${MAX_MANUFACTURER_DATA_BYTES})`)
  }
  const payload = new Uint8Array(2 + mfrLen)
  payload[0] = appearance & 0xff
  payload[1] = (appearance >> 8) & 0xff
  if (manufacturerData && mfrLen > 0) {
    payload.set(manufacturerData, 2)
  }
  return buildFrame(CMD_SET_ADV_DATA, payload)
}

export function buildSetAdvUuidsFrame(uuids: number[]): Uint8Array {
  if (uuids.length > MAX_ADVERTISED_UUIDS) {
    throw new Error(`Too many UUIDs: ${uuids.length} (max ${MAX_ADVERTISED_UUIDS})`)
  }
  const payload = new Uint8Array(uuids.length * 2)
  for (let i = 0; i < uuids.length; i++) {
    payload[i * 2] = uuids[i] & 0xff
    payload[i * 2 + 1] = (uuids[i] >> 8) & 0xff
  }
  return buildFrame(CMD_SET_ADV_UUIDS, payload)
}

export interface ParsedFrame {
  cmd: number
  payload: Uint8Array
}

/**
 * Stateful frame parser. Feed bytes via push(), get parsed frames from pull().
 */
export class FrameParser {
  private buf = new Uint8Array(0)

  push(data: Uint8Array) {
    const merged = new Uint8Array(this.buf.length + data.length)
    merged.set(this.buf)
    merged.set(data, this.buf.length)
    this.buf = merged
  }

  pull(): ParsedFrame[] {
    const frames: ParsedFrame[] = []
    while (this.buf.length >= 4) {
      const startIdx = this.buf.indexOf(START_BYTE)
      if (startIdx === -1) {
        this.buf = new Uint8Array()
        break
      }
      if (startIdx > 0) this.buf = this.buf.slice(startIdx)
      if (this.buf.length < 4) break

      const cmd = this.buf[1]
      const len = this.buf[2]
      const frameSize = 4 + len
      if (this.buf.length < frameSize) break

      const payload = this.buf.slice(3, 3 + len)
      const frameCrc = this.buf[3 + len]
      const crcData = new Uint8Array([cmd, len, ...payload])
      if (crc8(crcData) !== frameCrc) {
        this.buf = this.buf.slice(1)
        continue
      }

      frames.push({ cmd, payload })
      this.buf = this.buf.slice(frameSize)
    }
    return frames
  }
}
