/**
 * BLE UART Plugin Backend
 *
 * Implements the PluginBase class for BLE devices connected via USB-UART.
 * Uses the serialport npm package for serial communication.
 */

import { SerialPort } from 'serialport'
import { PluginBase, pluginToModule } from '../../sdk'
import type { PluginRoute, Schema, DeviceSettings, ModuleFactory } from '../../sdk'
import { validateSerialPortPath } from './validation'
import {
  BAUD_RATE,
  CMD_ADD_SERVICE,
  CMD_ADD_CHAR,
  CMD_APPLY_SCHEMA,
  CMD_SET_DEVICE_NAME,
  CMD_SET_ADV_DATA,
  CMD_SET_ADV_UUIDS,
  CMD_ACK,
  CMD_NACK,
  CMD_CHAR_WRITE_EVENT,
  CMD_CHAR_READ_EVENT,
  CMD_NOTIFY_CMD,
  CMD_READ_RESPONSE,
  CMD_PING,
  CMD_PONG,
  CMD_ADV_STARTED,
  CMD_ADV_FAILED,
  buildFrame,
  buildSetDeviceNameFrame,
  buildSetAdvDataFrame,
  buildSetAdvUuidsFrame,
  computeSchemaHash,
  uuidStrToBytes,
  extractShortUuid,
  FrameParser,
} from './protocol'

/** How long to wait for ACK before retry/failure (shorter for direct serial) */
const ACK_TIMEOUT_MS = 2000
/** Interval between ping frames to check device responsiveness */
const PING_INTERVAL_MS = 5000
/** If no pong received within interval + this timeout, device is considered unresponsive */
const PING_TIMEOUT_MS = 3000
/** Number of retries for commands before giving up */
const MAX_RETRY_ATTEMPTS = 3
/** Delay after opening port for UART to settle */
const UART_SETTLE_DELAY_MS = 500

function propsToMask(props: { read: boolean; write: boolean; notify: boolean }): number {
  return (props.read ? 0x01 : 0) | (props.write ? 0x02 : 0) | (props.notify ? 0x04 : 0)
}

/** Map UUIDs to svc_idx/chr_idx */
function uuidsToIndices(
  schema: Schema['services'],
  serviceUuid: string,
  charUuid: string
): { svcIdx: number; chrIdx: number } | null {
  for (let s = 0; s < schema.length; s++) {
    if (schema[s].uuid !== serviceUuid) continue
    for (let c = 0; c < schema[s].characteristics.length; c++) {
      if (schema[s].characteristics[c].uuid === charUuid) return { svcIdx: s, chrIdx: c }
    }
  }
  return null
}

/** Map svc_idx/chr_idx back to UUIDs */
function indicesToUuids(
  schema: Schema['services'],
  svcIdx: number,
  chrIdx: number
): { serviceUuid: string; charUuid: string } | null {
  if (svcIdx >= schema.length) return null
  const svc = schema[svcIdx]
  if (chrIdx >= svc.characteristics.length) return null
  return { serviceUuid: svc.uuid, charUuid: svc.characteristics[chrIdx].uuid }
}

class BleUartPlugin extends PluginBase {
  private port: SerialPort | null = null
  private schema: Schema | null = null
  private schemaHash: Uint8Array | null = null
  private parser = new FrameParser()
  private lastPong = Date.now()
  private schemaMismatchWarned = false
  private pingInterval: ReturnType<typeof setInterval> | null = null
  private selectedPortPath: string | null = null
  private ackResolvers = new Map<number, { resolve: () => void; reject: (err: Error) => void; timeoutId: ReturnType<typeof setTimeout> }>()
  private isUploading = false
  private isCleaningUp = false

  async onLoad(): Promise<void> {
    this.ctx.log('BLE UART plugin loaded')
  }

  async onUnload(): Promise<void> {
    await this.cleanup()
    this.ctx.log('BLE UART plugin unloaded')
  }

  isAvailable(): boolean {
    return true // Serial port support is always available in Node.js
  }

  getRoutes(): PluginRoute[] {
    return [
      {
        method: 'GET',
        path: '/ports',
        label: 'List Ports',
        description: 'List available serial ports',
        ui: {
          display: 'select-source',
          fieldId: 'port',
          fieldLabel: 'Serial Port',
          requiredForConnect: true,
        },
        handler: async () => {
          const ports = await SerialPort.list()
          // Standard select-option format: {value, label, description?}
          return ports.map((p) => ({
            value: p.path,
            label: p.path,
            description: p.manufacturer,
          }))
        },
      },
      {
        method: 'POST',
        path: '/select-port',
        label: 'Select Port',
        description: 'Select a serial port to use',
        ui: {
          display: 'select-target',
          fieldId: 'port',
        },
        handler: async (body?: unknown) => {
          const path = (body as { value?: unknown } | undefined)?.value
          if (!path || typeof path !== 'string') {
            throw new Error('value is required')
          }

          // Validate port path format
          const validation = validateSerialPortPath(path)
          if (!validation.valid) {
            throw new Error(validation.errors.join(', '))
          }

          // Verify the port exists. Listing may fail on some systems — warn and
          // continue in that case, but reject if listing works and the port is absent.
          let availablePorts: Awaited<ReturnType<typeof SerialPort.list>> | null = null
          try {
            availablePorts = await SerialPort.list()
          } catch (err) {
            this.ctx.log(`Warning: Could not verify port exists: ${err instanceof Error ? err.message : err}`)
          }
          if (availablePorts && !availablePorts.some((p) => p.path === path)) {
            throw new Error('Port does not exist')
          }

          this.selectedPortPath = path
          this.ctx.log(`Selected port: ${path}`)
          return { success: true, selectedValue: path }
        },
      },
      {
        method: 'GET',
        path: '/selected-port',
        label: 'Get Selected Port',
        description: 'Get currently selected serial port',
        ui: { display: 'hidden' },
        handler: () => ({ selectedValue: this.selectedPortPath }),
      },
    ]
  }

  async onUploadSchema(schema: Schema, settings: DeviceSettings): Promise<void> {
    if (!this.selectedPortPath) {
      throw new Error('No serial port selected. Use /select-port first.')
    }

    if (this.isUploading) {
      throw new Error('Schema upload already in progress')
    }

    this.isUploading = true

    try {
      // Close existing connection if any
      await this.cleanup()

      // Open serial port
      this.port = new SerialPort({
        path: this.selectedPortPath,
        baudRate: BAUD_RATE,
        autoOpen: false,
      })

      await new Promise<void>((resolve, reject) => {
        this.port!.open((err) => {
          if (err) reject(err)
          else resolve()
        })
      })

      this.schema = schema
      this.schemaHash = computeSchemaHash(schema.services)

      // Setup event handlers
      this.port.on('data', (data: Buffer) => {
        if (!this.isCleaningUp) {
          this.parser.push(new Uint8Array(data))
          this.processFrames()
        }
      })

      this.port.on('error', (err: Error) => {
        this.ctx.log(`Serial error: ${err.message}`)
        this.ctx.broadcast({ type: 'error', message: err.message })
      })

      this.port.on('close', () => {
        this.ctx.log('Serial port closed')
        this.ctx.broadcast({ type: 'disconnected', reason: 'Port closed' })
      })

      // Small delay for UART to settle
      await new Promise((r) => setTimeout(r, UART_SETTLE_DELAY_MS))

      // Send device name
      this.ctx.log(`SET_DEVICE_NAME "${settings.deviceName}"`)
      await this.sendAndWaitAck(buildSetDeviceNameFrame(settings.deviceName), CMD_SET_DEVICE_NAME)

      // Send advertising data if needed
      const appearance = settings.appearance ?? 0
      if (appearance !== 0 || (settings.manufacturerData && settings.manufacturerData.length > 0)) {
        const mfrBytes =
          settings.manufacturerData && settings.manufacturerData.length > 0
            ? new Uint8Array(settings.manufacturerData)
            : undefined
        this.ctx.log(
          `SET_ADV_DATA appearance=0x${appearance.toString(16).padStart(4, '0')}${mfrBytes ? ` mfr=${mfrBytes.length}B` : ''}`
        )
        await this.sendAndWaitAck(buildSetAdvDataFrame(appearance, mfrBytes), CMD_SET_ADV_DATA)
      }

      // Extract and send 16-bit service UUIDs for advertising
      const shortUuids: number[] = []
      for (const svc of schema.services) {
        const short = extractShortUuid(svc.uuid)
        if (short !== null && !shortUuids.includes(short)) {
          shortUuids.push(short)
        }
      }
      if (shortUuids.length > 0) {
        const uuidsToSend = shortUuids.slice(0, 2) // Limit to 2 UUIDs to fit in advertising packet
        this.ctx.log(`SET_ADV_UUIDS [${uuidsToSend.map((u) => '0x' + u.toString(16).padStart(4, '0')).join(', ')}]`)
        await this.sendAndWaitAck(buildSetAdvUuidsFrame(uuidsToSend), CMD_SET_ADV_UUIDS)
      }

      // Upload schema
      for (let svcIdx = 0; svcIdx < schema.services.length; svcIdx++) {
        const svc = schema.services[svcIdx]
        const svcPayload = new Uint8Array([svcIdx, ...uuidStrToBytes(svc.uuid)])
        this.ctx.log(`ADD_SERVICE [${svcIdx}] ${svc.uuid}`)
        await this.sendAndWaitAck(buildFrame(CMD_ADD_SERVICE, svcPayload), CMD_ADD_SERVICE)

        for (let chrIdx = 0; chrIdx < svc.characteristics.length; chrIdx++) {
          const chr = svc.characteristics[chrIdx]
          const props = propsToMask(chr.properties)
          const defaultBytes = chr.defaultValue ? new Uint8Array(chr.defaultValue) : new Uint8Array()
          const chrPayload = new Uint8Array([svcIdx, chrIdx, props, ...uuidStrToBytes(chr.uuid), ...defaultBytes])
          this.ctx.log(`  ADD_CHAR [${svcIdx}:${chrIdx}] props=0x${props.toString(16).padStart(2, '0')} ${chr.uuid}`)
          await this.sendAndWaitAck(buildFrame(CMD_ADD_CHAR, chrPayload), CMD_ADD_CHAR)
        }
      }

      this.ctx.log('APPLY_SCHEMA')
      await this.sendAndWaitAck(buildFrame(CMD_APPLY_SCHEMA), CMD_APPLY_SCHEMA)
      this.ctx.log('Schema uploaded successfully!')
    } finally {
      this.isUploading = false
    }
  }

  async onConnect(): Promise<void> {
    if (!this.port || !this.port.isOpen) {
      throw new Error('Port not open. Upload schema first.')
    }

    // Clear any existing ping interval before starting new one
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }

    // Start ping/pong heartbeat
    this.lastPong = Date.now()
    this.schemaMismatchWarned = false

    // Send initial ping
    this.sendFrame(CMD_PING, this.schemaHash!)

    // Start ping interval
    this.pingInterval = setInterval(() => {
      if (Date.now() - this.lastPong > PING_INTERVAL_MS + PING_TIMEOUT_MS) {
        this.ctx.broadcast({ type: 'disconnected', reason: 'Device not responding' })
        this.cleanup()
        return
      }
      this.sendFrame(CMD_PING, this.schemaHash!)
    }, PING_INTERVAL_MS)

    this.ctx.broadcast({ type: 'connected' })
  }

  async onDisconnect(): Promise<void> {
    await this.cleanup()
    this.ctx.broadcast({ type: 'disconnected' })
  }

  async onNotify(serviceUuid: string, charUuid: string, data: Uint8Array): Promise<void> {
    if (!this.schema || !this.port) throw new Error('Not connected')
    const idx = uuidsToIndices(this.schema.services, serviceUuid, charUuid)
    if (!idx) throw new Error('Characteristic not found in schema')
    const payload = new Uint8Array([idx.svcIdx, idx.chrIdx, ...data])
    this.sendFrame(CMD_NOTIFY_CMD, payload)
  }

  async onRespondToRead(serviceUuid: string, charUuid: string, data: Uint8Array): Promise<void> {
    if (!this.schema || !this.port) throw new Error('Not connected')
    const idx = uuidsToIndices(this.schema.services, serviceUuid, charUuid)
    if (!idx) throw new Error('Characteristic not found in schema')
    const payload = new Uint8Array([idx.svcIdx, idx.chrIdx, ...data])
    this.sendFrame(CMD_READ_RESPONSE, payload)
  }

  private processFrames(): void {
    if (this.isCleaningUp) {
      return
    }

    const frames = this.parser.pull()

    for (const frame of frames) {
      switch (frame.cmd) {
        case CMD_ACK:
          if (frame.payload.length >= 1) {
            const ackCmd = frame.payload[0]
            const resolver = this.ackResolvers.get(ackCmd)
            if (resolver) {
              clearTimeout(resolver.timeoutId)
              resolver.resolve()
              this.ackResolvers.delete(ackCmd)
            }
          }
          break

        case CMD_NACK:
          if (frame.payload.length >= 2) {
            const nackCmd = frame.payload[0]
            const errorCode = frame.payload[1]
            const resolver = this.ackResolvers.get(nackCmd)
            if (resolver) {
              clearTimeout(resolver.timeoutId)
              resolver.reject(new Error(`NACK for cmd 0x${nackCmd.toString(16)}, error=0x${errorCode.toString(16)}`))
              this.ackResolvers.delete(nackCmd)
            }
          }
          break

        case CMD_PONG:
          this.lastPong = Date.now()
          // Check schema hash
          if (frame.payload.length >= 4 && !this.schemaMismatchWarned && this.schemaHash) {
            const deviceHash = frame.payload.slice(0, 4)
            const match = this.schemaHash.every((b, i) => b === deviceHash[i])
            if (!match) {
              this.schemaMismatchWarned = true
              this.ctx.broadcast({ type: 'schema-mismatch' })
            }
          }
          break

        case CMD_CHAR_WRITE_EVENT:
          if (frame.payload.length >= 2 && this.schema) {
            const svcIdx = frame.payload[0]
            const chrIdx = frame.payload[1]
            const data = frame.payload.slice(2)
            const uuids = indicesToUuids(this.schema.services, svcIdx, chrIdx)
            if (uuids) {
              this.ctx.broadcast({
                type: 'char-write',
                serviceUuid: uuids.serviceUuid,
                charUuid: uuids.charUuid,
                data: Array.from(data),
              })
            }
          }
          break

        case CMD_CHAR_READ_EVENT:
          if (frame.payload.length >= 2 && this.schema) {
            const svcIdx = frame.payload[0]
            const chrIdx = frame.payload[1]
            const uuids = indicesToUuids(this.schema.services, svcIdx, chrIdx)
            if (uuids) {
              this.ctx.broadcast({
                type: 'char-read',
                serviceUuid: uuids.serviceUuid,
                charUuid: uuids.charUuid,
              })
            }
          }
          break

        case CMD_ADV_STARTED:
          this.ctx.log('Advertising started successfully')
          this.ctx.broadcast({ type: 'adv-started' })
          break

        case CMD_ADV_FAILED: {
          const stage = frame.payload.length >= 2 ? frame.payload[0] : 0
          const errorCode = frame.payload.length >= 2 ? frame.payload[1] : 0
          const stageStr = stage === 0x01 ? 'set_fields' : stage === 0x02 ? 'adv_start' : 'unknown'
          this.ctx.log(`BLE advertising FAILED: stage=${stageStr}, error=0x${errorCode.toString(16)}`)
          this.ctx.broadcast({ type: 'adv-failed', stage: stageStr, errorCode })
          // Stop the session - advertising is required for BLE operation
          this.ctx.log('Stopping session due to advertising failure')
          void this.onDisconnect()
          break
        }
      }
    }
  }

  private sendFrame(cmd: number, payload: Uint8Array): void {
    if (this.port && this.port.isOpen) {
      const frame = buildFrame(cmd, payload)
      this.port.write(Buffer.from(frame))
    }
  }

  private async sendAndWaitAck(frame: Uint8Array, expectedCmd: number, attempt = 1): Promise<void> {
    return new Promise((resolve, reject) => {
      // Set timeout
      const timeoutId = setTimeout(() => {
        this.ackResolvers.delete(expectedCmd)

        // Retry logic
        if (attempt < MAX_RETRY_ATTEMPTS) {
          this.ctx.log(`Timeout for cmd 0x${expectedCmd.toString(16)}, retrying (attempt ${attempt + 1}/${MAX_RETRY_ATTEMPTS})`)
          this.sendAndWaitAck(frame, expectedCmd, attempt + 1)
            .then(resolve)
            .catch(reject)
        } else {
          reject(new Error(`Timeout waiting for ACK (cmd 0x${expectedCmd.toString(16)}) after ${MAX_RETRY_ATTEMPTS} attempts`))
        }
      }, ACK_TIMEOUT_MS)

      // Set up ACK handler with timeout reference
      this.ackResolvers.set(expectedCmd, { resolve, reject, timeoutId })

      // Send frame
      if (this.port && this.port.isOpen) {
        this.port.write(Buffer.from(frame))
      } else {
        clearTimeout(timeoutId)
        this.ackResolvers.delete(expectedCmd)
        reject(new Error('Port not open'))
      }
    })
  }

  private async cleanup(): Promise<void> {
    this.isCleaningUp = true

    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }

    // Clear all pending ACK resolvers before closing port
    for (const [, resolver] of this.ackResolvers) {
      clearTimeout(resolver.timeoutId)
      resolver.reject(new Error('Connection closed'))
    }
    this.ackResolvers.clear()

    if (this.port) {
      this.port.removeAllListeners()

      if (this.port.isOpen) {
        await new Promise<void>((resolve) => {
          this.port!.close((err) => {
            if (err) this.ctx.log(`Error closing port: ${err.message}`)
            resolve()
          })
        })
      }
    }
    this.port = null
    this.isCleaningUp = false
  }
}

const factory: ModuleFactory = (ctx, manifest) => pluginToModule(new BleUartPlugin(ctx), manifest)
export default factory
