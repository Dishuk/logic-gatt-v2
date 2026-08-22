import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "LogicGATT",
		identifier: "com.dishuk.logicgatt.desktop",
		version: "1.0.1",
	},
	build: {
		// Vite builds to dist/, we copy from there
		copy: {
			"dist/index.html": "views/mainview/index.html",
			"dist/assets": "views/mainview/assets",
			// Frozen usb-ble bridge. Mirrors the source layout so the same
			// `new URL("./modules/plugins/", import.meta.url)` resolves in dev and shipped.
			// Built per-OS by `make usb-ble-bridge`; absent until then.
			"src/bun/modules/plugins/usb-ble/bin": "bun/modules/plugins/usb-ble/bin",
		},
		// Ignore Vite output in watch mode — HMR handles view rebuilds separately
		watchIgnore: ["dist/**"],
		mac: {
			bundleCEF: false,
		},
		linux: {
			bundleCEF: false,
		},
		win: {
			bundleCEF: false,
			icon: "assets/icon.ico",
		},
	},
	// Electrobun 1.18.1's own rcedit icon-embed is broken (can't resolve rcedit
	// from its compiled CLI); embed it ourselves before the tarball is built.
	scripts: {
		postBuild: "scripts/embed-icon.ts",
	},
} satisfies ElectrobunConfig;
