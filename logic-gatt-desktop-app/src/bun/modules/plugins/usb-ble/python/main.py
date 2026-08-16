"""
USB BLE Backend - Python/bless implementation

Simple BLE GATT server that bridges between the frontend (WebSocket) and PC Bluetooth adapter.
Uses the 'bless' library which leverages native OS BLE APIs:
  - Windows: WinRT
  - macOS: CoreBluetooth
  - Linux: BlueZ/D-Bus

Usage:
    pip install -r requirements.txt
    python main.py
"""

import asyncio
import json
import logging
import signal
import sys
from typing import Any
from uuid import UUID

import websockets
from websockets import ServerConnection

from bless import BlessServer, BlessGATTCharacteristic, GATTCharacteristicProperties, GATTAttributePermissions

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S"
)
log = logging.getLogger("ble-backend")

# WebSocket port (8766: 8765 is used by the desktop's mobile Wi-Fi transport)
WS_PORT = 8766


class BleGattServer:
    """BLE GATT server wrapper using bless library."""

    def __init__(self):
        self.server: BlessServer | None = None
        self.device_name = "USB-BLE-Device"
        self.is_advertising = False
        self.char_values: dict[str, bytes] = {}  # char_uuid -> current value
        self.char_to_service: dict[str, str] = {}  # char_uuid -> service_uuid
        self.pending_reads: dict[str, asyncio.Future] = {}  # char_uuid -> Future
        self.loop: asyncio.AbstractEventLoop | None = None  # For scheduling from sync callbacks

        # Callbacks
        self.on_char_write: callable | None = None
        self.on_char_read: callable | None = None

    def _read_request_handler(self, characteristic: BlessGATTCharacteristic, **kwargs) -> bytearray:
        """Handle BLE read requests."""
        char_uuid = str(characteristic.uuid)
        service_uuid = self.char_to_service.get(char_uuid, "")
        log.info(f"[BLE] Read request: {service_uuid}/{char_uuid}")

        # Notify frontend about the read (schedule on main loop from sync callback)
        if self.on_char_read and self.loop:
            asyncio.run_coroutine_threadsafe(self.on_char_read(service_uuid, char_uuid), self.loop)

        # Return current value (frontend can update via respond-to-read)
        value = self.char_values.get(char_uuid, b"")
        return bytearray(value)

    def _write_request_handler(self, characteristic: BlessGATTCharacteristic, value: Any, **kwargs):
        """Handle BLE write requests."""
        char_uuid = str(characteristic.uuid)
        service_uuid = self.char_to_service.get(char_uuid, "")
        data = bytes(value) if value else b""
        log.info(f"[BLE] Write request: {service_uuid}/{char_uuid} data={data.hex()}")

        # Store value
        self.char_values[char_uuid] = data

        # Notify frontend (schedule on main loop from sync callback)
        if self.on_char_write and self.loop:
            asyncio.run_coroutine_threadsafe(self.on_char_write(service_uuid, char_uuid, data), self.loop)

    async def upload_schema(self, services: list[dict], settings: dict):
        """Upload GATT schema and configure services."""
        # Store event loop reference for sync callbacks
        self.loop = asyncio.get_running_loop()

        # Stop existing server if running
        if self.server and self.is_advertising:
            await self.stop_advertising()

        self.device_name = settings.get("deviceName", "USB-BLE-Device")
        self.char_values.clear()
        self.char_to_service.clear()

        # Create new server (name_overwrite=True for custom device name)
        log.info(f"[BLE] Creating BlessServer as '{self.device_name}'...")
        self.server = BlessServer(name=self.device_name, loop=asyncio.get_event_loop(), name_overwrite=True)
        self.server.read_request_func = self._read_request_handler
        self.server.write_request_func = self._write_request_handler

        # Add services and characteristics BEFORE starting (required by bless)
        for svc_def in services:
            service_uuid = svc_def["uuid"]
            try:
                await asyncio.wait_for(self.server.add_new_service(service_uuid), timeout=5.0)
            except asyncio.TimeoutError:
                raise RuntimeError(f"Timeout adding service {service_uuid}")
            log.info(f"[BLE] Added service: {service_uuid}")

            for char_def in svc_def.get("characteristics", []):
                char_uuid = char_def["uuid"]
                props = char_def.get("properties", {})

                # Build properties flags
                gatt_props = GATTCharacteristicProperties.read  # Always readable
                if props.get("write"):
                    gatt_props |= GATTCharacteristicProperties.write
                    gatt_props |= GATTCharacteristicProperties.write_without_response
                if props.get("notify"):
                    gatt_props |= GATTCharacteristicProperties.notify

                # Build permissions
                permissions = GATTAttributePermissions.readable
                if props.get("write"):
                    permissions |= GATTAttributePermissions.writeable

                # Default value
                default_value = char_def.get("defaultValue", [])
                if isinstance(default_value, list):
                    default_value = bytes(default_value)
                elif isinstance(default_value, str):
                    default_value = default_value.encode()
                else:
                    default_value = b""

                self.char_values[char_uuid] = default_value
                self.char_to_service[char_uuid] = service_uuid

                try:
                    await asyncio.wait_for(
                        self.server.add_new_characteristic(
                            service_uuid,
                            char_uuid,
                            gatt_props,
                            bytearray(default_value),
                            permissions
                        ),
                        timeout=5.0
                    )
                except asyncio.TimeoutError:
                    raise RuntimeError(f"Timeout adding characteristic {char_uuid}")
                log.info(f"[BLE] Added characteristic: {char_uuid}")

        # Start the server AFTER adding all services (required by bless)
        log.info("[BLE] Starting BLE server (this may take a moment)...")
        try:
            await asyncio.wait_for(self.server.start(), timeout=10.0)
        except asyncio.TimeoutError:
            raise RuntimeError("BLE server start timed out - check if Bluetooth is enabled and no other app is using it")
        log.info(f"[BLE] Server started as '{self.device_name}'")
        log.info(f"[BLE] Schema uploaded: {len(services)} services")

    async def start_advertising(self):
        """Start BLE advertising."""
        if not self.server:
            raise RuntimeError("No schema uploaded")

        # bless starts advertising automatically after adding services
        # Just mark as advertising
        self.is_advertising = True
        log.info(f"[BLE] Advertising started as '{self.device_name}'")

    async def stop_advertising(self):
        """Stop BLE advertising."""
        if self.server:
            await self.server.stop()
            self.server = None
        self.is_advertising = False
        log.info("[BLE] Advertising stopped")

    async def notify(self, char_uuid: str, data: bytes):
        """Send BLE notification."""
        if not self.server:
            log.warning("[BLE] Cannot notify: server not running")
            return

        if not char_uuid:
            raise ValueError("charUuid is required for notify")

        # Validate UUID format
        try:
            UUID(char_uuid)
        except ValueError as e:
            raise ValueError(f"Invalid charUuid '{char_uuid}': {e}")

        self.char_values[char_uuid] = data
        service_uuid = self.char_to_service.get(char_uuid)

        # Update the characteristic value in bless (required for notifications)
        char = self.server.get_characteristic(char_uuid)
        if char:
            char.value = bytearray(data)
        else:
            log.warning(f"[BLE] Characteristic not found in bless: {char_uuid}")

        self.server.update_value(service_uuid, char_uuid)
        log.info(f"[BLE] Notification sent: {char_uuid} data={data.hex()}")

    async def respond_to_read(self, char_uuid: str, data: bytes):
        """Update characteristic value for read responses (no notification)."""
        self.char_values[char_uuid] = data
        if self.server:
            # Set value in bless - this is what subsequent reads will return
            char = self.server.get_characteristic(char_uuid)
            if char:
                char.value = bytearray(data)
            else:
                log.warning(f"[BLE] Characteristic not found in bless: {char_uuid}")
            # Note: Don't call update_value() here - that sends notifications,
            # which fails on read-only characteristics
        log.info(f"[BLE] Read response updated: {char_uuid} data={data.hex()}")


class WebSocketHandler:
    """WebSocket protocol handler."""

    def __init__(self, ble_server: BleGattServer):
        self.ble = ble_server
        self.clients: set[ServerConnection] = set()

        # Wire up BLE callbacks
        self.ble.on_char_write = self._on_char_write
        self.ble.on_char_read = self._on_char_read

    async def _on_char_write(self, service_uuid: str, char_uuid: str, data: bytes):
        """Forward BLE write events to frontend."""
        await self.broadcast({
            "type": "char-write-event",
            "serviceUuid": service_uuid,
            "charUuid": char_uuid,
            "data": list(data)
        })

    async def _on_char_read(self, service_uuid: str, char_uuid: str):
        """Forward BLE read events to frontend."""
        await self.broadcast({
            "type": "char-read-event",
            "serviceUuid": service_uuid,
            "charUuid": char_uuid
        })

    async def broadcast(self, message: dict):
        """Send message to all connected clients."""
        if not self.clients:
            return
        msg = json.dumps(message)
        await asyncio.gather(
            *[client.send(msg) for client in self.clients],
            return_exceptions=True
        )

    async def send(self, ws: ServerConnection, message: dict):
        """Send message to specific client."""
        await ws.send(json.dumps(message))

    async def handle_message(self, ws: ServerConnection, message: str):
        """Handle incoming WebSocket message."""
        try:
            msg = json.loads(message)
        except json.JSONDecodeError:
            await self.send(ws, {"type": "nack", "requestId": "", "error": "Invalid JSON"})
            return

        msg_type = msg.get("type", "")
        request_id = msg.get("requestId", "")
        log.info(f"[WS] Received: {msg_type} (id={request_id})")

        try:
            if msg_type == "ping":
                await self.send(ws, {"type": "pong", "requestId": request_id})

            elif msg_type == "upload-schema":
                # Frontend sends schema.services, not services directly
                schema = msg.get("schema", {})
                services = schema.get("services", [])
                settings = msg.get("settings", {})
                await self.ble.upload_schema(services, settings)
                await self.send(ws, {"type": "ack", "requestId": request_id})

            elif msg_type == "start-advertising":
                await self.ble.start_advertising()
                await self.send(ws, {"type": "ack", "requestId": request_id})

            elif msg_type == "stop-advertising":
                await self.ble.stop_advertising()
                await self.send(ws, {"type": "ack", "requestId": request_id})

            elif msg_type == "notify":
                char_uuid = msg.get("charUuid", "")
                data = bytes(msg.get("data", []))
                log.info(f"[WS] Notify request: charUuid='{char_uuid}' data_len={len(data)}")
                await self.ble.notify(char_uuid, data)
                await self.send(ws, {"type": "ack", "requestId": request_id})

            elif msg_type == "respond-to-read":
                char_uuid = msg.get("charUuid", "")
                data = bytes(msg.get("data", []))
                await self.ble.respond_to_read(char_uuid, data)
                await self.send(ws, {"type": "ack", "requestId": request_id})

            elif msg_type == "disconnect":
                await self.ble.stop_advertising()
                # Don't send ACK - client is closing the connection

            else:
                await self.send(ws, {"type": "nack", "requestId": request_id, "error": f"Unknown message type: {msg_type}"})

        except websockets.exceptions.ConnectionClosed:
            log.debug(f"[WS] Connection closed while handling {msg_type}")
        except Exception as e:
            log.exception(f"[WS] Error handling {msg_type}")
            try:
                await self.send(ws, {"type": "nack", "requestId": request_id, "error": str(e)})
            except websockets.exceptions.ConnectionClosed:
                pass  # Client already disconnected

    async def handle_connection(self, ws: ServerConnection):
        """Handle WebSocket connection lifecycle."""
        self.clients.add(ws)
        remote = ws.remote_address
        log.info(f"[WS] Client connected: {remote}")

        # Send ready message
        await self.send(ws, {"type": "connected"})

        try:
            async for message in ws:
                await self.handle_message(ws, message)
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            self.clients.discard(ws)
            log.info(f"[WS] Client disconnected: {remote}")


async def main():
    """Main entry point."""
    log.info("USB BLE Backend starting...")
    log.info("Using real Bluetooth adapter (no mock mode)")

    # Create BLE server
    ble_server = BleGattServer()

    # Create WebSocket handler
    ws_handler = WebSocketHandler(ble_server)

    # Start WebSocket server
    stop_event = asyncio.Event()

    async with websockets.serve(ws_handler.handle_connection, "localhost", WS_PORT):
        log.info(f"WebSocket server listening on ws://localhost:{WS_PORT}")
        log.info("Waiting for frontend connection...")

        # Wait for shutdown signal
        loop = asyncio.get_event_loop()

        def shutdown():
            log.info("Shutting down...")
            stop_event.set()

        # Handle Ctrl+C
        if sys.platform != "win32":
            loop.add_signal_handler(signal.SIGINT, shutdown)
            loop.add_signal_handler(signal.SIGTERM, shutdown)

        await stop_event.wait()

    # Cleanup
    await ble_server.stop_advertising()
    log.info("Goodbye!")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.info("Interrupted by user")
