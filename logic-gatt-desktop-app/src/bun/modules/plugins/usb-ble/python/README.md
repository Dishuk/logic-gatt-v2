# USB BLE bridge

BLE GATT server that drives the PC's own Bluetooth adapter as a peripheral, bridging it to
the desktop app over a local WebSocket (`ws://localhost:8766`).

Shipped as a frozen single-file binary, so no Python installation is needed at runtime.

## Platform support

| Platform | BLE backend | Notes |
|----------|-------------|-------|
| Windows 10/11 | WinRT | May require Administrator privileges |
| Linux | BlueZ / D-Bus | Requires the `bluez` package and adapter permissions |

macOS is not supported by this module — the mobile executor covers that case.

An adapter capable of BLE peripheral mode is required; most Bluetooth 5.0+ adapters qualify.

## Building

Requires [uv](https://docs.astral.sh/uv/) on PATH. It fetches the pinned CPython, so no
system Python install is needed.

```bash
make usb-ble-bridge     # from the repository root
make build              # equivalent, from this directory
```

The binary lands at `../bin/logicgatt-blebridge[.exe]` and is picked up automatically by the
plugin and by `bun run build:canary`.

PyInstaller cannot cross-compile, so this must be run **on each OS being shipped**.

## Development

```bash
make venv    # create the environment
make run     # run from source
make clean
```

With no frozen binary present, the plugin falls back to this venv automatically.

## Why Python 3.11

`bless` 0.3.0 pins `winrt-*` to `2.0.0b1` for Python 3.12+ while also requiring
`bleak>=1.1.1`, which needs `winrt-* >= 3.1`. Those constraints cannot both be satisfied, so
3.12+ fails to resolve on Windows. 3.11 additionally has prebuilt `bleak-winrt` wheels, so no
C++ toolchain is needed.

`pysetupdi` is an undeclared `bless` dependency — its WinRT adapter imports it, but it is
absent from the package metadata and unpublished on PyPI, hence the pinned git requirement.

## How it works

1. The bridge starts a WebSocket server on `ws://localhost:8766`.
2. The desktop app connects and sends a GATT schema (services/characteristics).
3. The bridge builds a BLE GATT server on the PC's Bluetooth adapter.
4. BLE centrals connect and interact with that server.
5. Read/write/notify events are forwarded back over the WebSocket.

## WebSocket protocol

### Desktop -> bridge

| Type | Fields | Description |
|------|--------|-------------|
| `ping` | - | Heartbeat |
| `upload-schema` | `services`, `settings` | Upload GATT schema |
| `start-advertising` | - | Start BLE advertising |
| `stop-advertising` | - | Stop BLE advertising |
| `notify` | `charUuid`, `data` | Send notification |
| `respond-to-read` | `charUuid`, `data` | Respond to read request |
| `disconnect` | - | Stop and disconnect |

### Bridge -> desktop

| Type | Fields | Description |
|------|--------|-------------|
| `pong` | - | Heartbeat response |
| `ack` | `command` | Command succeeded |
| `nack` | `error` | Command failed |
| `connected` | - | WebSocket connected, BLE ready |
| `char-write-event` | `charUuid`, `data` | Central wrote to a characteristic |
| `char-read-event` | `charUuid` | Central read a characteristic |

## Troubleshooting

**Bluetooth adapter not found**
- Windows: confirm Bluetooth is enabled in Settings and the adapter appears in Device Manager.
- Linux: `hciconfig` lists adapters; `bluez` must be installed.

**Permission denied**
- Windows: the bridge may need to run as Administrator.
- Linux: adding the user to the `bluetooth` group (`sudo usermod -aG bluetooth $USER`) and
  re-logging in usually resolves it.

**BLE peripheral mode not supported**
- Not every adapter can act as a GATT server. A different Bluetooth 5.0+ dongle often works.
- Linux: `btmgmt info` reports adapter capabilities.
