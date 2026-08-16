# LogicGATT Mobile

The BLE **peripheral** (GATT server) half of LogicGATT. A stateless relay: the desktop
controller holds all schema and scenario logic; this app advertises the GATT server, runs
native GATT operations on command, and forwards BLE events back over the local network.

## How it works

- **useExecutor** (`src/features/executor/`) — a WebSocket client to the desktop. Receives
  commands (upload-schema, notify, respond-to-read, connect, disconnect) and sends events back.
- **gattBridge** — translates desktop commands into `expo-gatt-server` native calls, and
  native GATT events (central connected, read, write) back into messages for the desktop.
- **useMdns** (`src/features/connection/`) — discovers the desktop via mDNS
  (`_logicgatt._tcp`); the desktop can also be reached by scanning its QR code.
- **expo-gatt-server** — the native module (iOS CoreBluetooth / Android BluetoothGattServer)
  that provides the BLE peripheral. Consumed as a pinned git dependency.

The phone keeps no state beyond the current connection and the schema the desktop uploaded.

## Run

BLE peripheral support is a native module, so the app runs as a native dev build (not Expo Go):

```bash
npm install
npx expo run:android    # or: npx expo run:ios
```

Or from the repo root: `make android` / `make ios`.

## Connect

1. Start the desktop app and select the Mobile transport (it starts a Wi-Fi server and shows
   a QR code).
2. On the phone, scan the QR code or pick the desktop from the mDNS list.
3. Desktop and phone must be on the same Wi-Fi network.

## Structure

```
src/
├── app/                # Expo Router screens
├── features/
│   ├── connection/     # mDNS discovery (useMdns)
│   └── executor/       # WebSocket client + GATT bridge (useExecutor, gattBridge)
└── lib/                # logger, helpers
```
