/**
 * Transport types for device communication.
 *
 * Re-exports shared types and adds frontend-specific transport interfaces.
 */

import type { Schema, DeviceSettings } from '@/types'
import type { PluginEvent } from '@logic-gatt/shared'

// Re-export shared types for convenience
export type { PluginEvent, PluginCommand, PluginAction, PluginInfo as BackendPluginInfo } from '@logic-gatt/shared'

// Also export wire format types
export type { Schema as WireSchema, DeviceSettings as WireDeviceSettings } from '@logic-gatt/shared'

// ============================================================================
// Frontend Transport Types
// ============================================================================

/**
 * Convert wire format (number[]) to frontend format (Uint8Array) for binary data.
 * This transforms PluginEvent to use Uint8Array instead of number[] for efficiency.
 */
type WireToFrontend<T> = T extends { data: number[] } ? Omit<T, 'data'> & { data: Uint8Array } : T

/** Events from device to frontend (uses Uint8Array for binary data) */
export type TransportEvent = WireToFrontend<PluginEvent>

export type TransportEventHandler = (event: TransportEvent) => void

/** Active connection to device */
export interface TransportConnection {
  /** Upload GATT schema and device settings */
  uploadSchema(schema: Schema, settings: DeviceSettings, log: (msg: string) => void): Promise<void>

  /** Send BLE notification */
  notify(serviceUuid: string, charUuid: string, data: Uint8Array): Promise<void>

  /** Respond to a read request */
  respondToRead(serviceUuid: string, charUuid: string, data: Uint8Array): Promise<void>

  /** Subscribe to device events. Returns unsubscribe function */
  onEvent(handler: TransportEventHandler): () => void

  /**
   * Stop the emulated device (stop advertising / tear down the GATT server on the
   * executor) but KEEP the transport link open. This is what "Stop" does, so the
   * user can Upload & Run again without reconnecting.
   */
  stopDevice(): Promise<void>

  /** Fully drop the transport link (and, for the mobile module, the Wi-Fi server). */
  disconnect(): Promise<void>
}
