# USB BLE Backend

Simple BLE GATT server that bridges between the frontend and the PC's Bluetooth adapter.

## Requirements

- Python 3.10+
- Bluetooth adapter that supports BLE peripheral mode (most Bluetooth 5.0+ adapters work)

### Platform Support

| Platform | BLE Backend | Notes |
|----------|-------------|-------|
| Windows 10/11 | WinRT APIs | May require Administrator privileges |
| macOS 10.15+ | CoreBluetooth | Works out of the box |
| Linux | BlueZ/D-Bus | Requires `bluez` package and proper permissions |

## Quick Start

From the plugin directory (`plugins/usb-ble/`):

```bash
# Create venv and install dependencies
make venv

# Run the backend
make python
```

**Manual setup:**
```bash
# Create virtual environment
python -m venv venv

# Activate it
venv\Scripts\activate   # Windows
source venv/bin/activate # Linux/macOS

# Install dependencies
pip install -r requirements.txt

# Run
python main.py
```

## How It Works

1. The backend starts a WebSocket server on `ws://localhost:8766`
2. The frontend connects and sends a GATT schema (services/characteristics)
3. The backend creates a BLE GATT server using the PC's Bluetooth adapter
4. BLE clients can connect and interact with the GATT server
5. Read/write/notify events are forwarded to the frontend via WebSocket

## WebSocket Protocol

### Frontend -> Backend

| Type | Fields | Description |
|------|--------|-------------|
| `ping` | - | Heartbeat |
| `upload-schema` | `services`, `settings` | Upload GATT schema |
| `start-advertising` | - | Start BLE advertising |
| `stop-advertising` | - | Stop BLE advertising |
| `notify` | `charUuid`, `data` | Send notification |
| `respond-to-read` | `charUuid`, `data` | Respond to read request |
| `disconnect` | - | Stop and disconnect |

### Backend -> Frontend

| Type | Fields | Description |
|------|--------|-------------|
| `pong` | - | Heartbeat response |
| `ack` | `command` | Command succeeded |
| `nack` | `error` | Command failed |
| `connected` | - | WebSocket connected, BLE ready |
| `char-write-event` | `charUuid`, `data` | Client wrote to characteristic |
| `char-read-event` | `charUuid` | Client read from characteristic |

## Troubleshooting

### "Bluetooth adapter not found"
- **Windows**: Ensure Bluetooth is enabled in Settings, check Device Manager
- **macOS**: Check System Preferences > Bluetooth
- **Linux**: Run `hciconfig` to list adapters, ensure `bluez` is installed

### "Permission denied" or similar
- **Windows**: Run as Administrator
- **macOS**: Grant Bluetooth permissions in System Preferences > Security & Privacy
- **Linux**: Add user to `bluetooth` group: `sudo usermod -aG bluetooth $USER` (re-login required)

### "BLE peripheral mode not supported"
- Not all Bluetooth adapters support acting as a GATT server
- Try a different USB Bluetooth 5.0 dongle
- **Linux**: Check adapter capabilities with `btmgmt info`

## Building Standalone Executable

To create a single `.exe` file that users can run without installing Python:

```bash
pip install pyinstaller
pyinstaller --onefile --name ble-backend main.py
```

The executable will be in the `dist/` folder.
