# LogicGATT Desktop

The **controller** half of LogicGATT: an [Electrobun](https://github.com/blackboardsh/electrobun)
desktop app (Bun runtime + system webview) where GATT services are designed, response logic is
written, and an emulated BLE peripheral is driven.

The desktop does **no BLE itself**. It talks to the LogicGATT mobile app — which runs as the
real BLE GATT server (peripheral) — over the local network (WebSocket + mDNS).

The schema + scenario/function model (how the device's behavior is defined) is documented in
[docs/LOGIC_CONSTRUCTOR.md](docs/LOGIC_CONSTRUCTOR.md).

> Electrobun is **not** Electron: it runs on Bun (not Node), uses the system webview (not
> bundled Chromium), and has its own main-process ↔ webview RPC. The
> [Electrobun docs](https://github.com/blackboardsh/electrobun) and `electrobun.config.ts`
> should be consulted before changing desktop code.

## Getting started

```bash
bun install

bun run dev        # Electrobun with a bundled webview build (electrobun dev --watch)
bun run dev:hmr    # Vite HMR on :5173 + Electrobun (recommended while developing the UI)
bun run build:canary   # Build a canary installer -> artifacts/canary-win-x64-LogicGATT-Setup-canary.zip
bun run build:stable   # Build a stable installer -> artifacts/stable-win-x64-LogicGATT-Setup.zip

bun run test       # Vitest
```

From the repo root, the `Makefile` wraps these (`make dev`, `make hmr`, `make build`); mise only provisions Node + Bun.

## How HMR works

`bun run dev:hmr` starts the Vite dev server on `http://localhost:5173`; the Bun main process
detects it (`src/bun/index.ts`) and loads the webview from Vite instead of the bundled assets,
so React changes apply instantly. `bun run dev` loads the bundled `views://mainview/index.html`.

## Project structure

```
├── src/
│   ├── bun/                   # Main process (Bun)
│   │   ├── index.ts           # Entry: RPC handlers, window, module registry
│   │   ├── connection-server.ts  # Wi-Fi transport: WebSocket + mDNS to the phone
│   │   ├── logger.ts          # Session-scoped rotating file logs
│   │   ├── presets/           # Built-in example projects (Examples menu)
│   │   └── modules/           # Transport modules (mobile executor + plugins)
│   ├── mainview/              # React webview UI (components, hooks, lib)
│   └── shared/                # RPC + wire types shared across the boundary
├── electrobun.config.ts       # App metadata + build config
├── vite.config.ts             # Vite (webview bundling + aliases)
└── tailwind.config.js
```

Design tokens come from the repo-root `../shared` package (`@logic-gatt/theme`); the CSS is
regenerated with `make gen-theme`.
