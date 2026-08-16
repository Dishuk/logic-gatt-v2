import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
	plugins: [react()],
	root: "src/mainview",
	resolve: {
		alias: {
			"@": r("./src/mainview"),
			"@shared": r("./src/shared"),
			"@logic-gatt/shared": r("./src/shared/wire.ts"),
			"@logic-gatt/theme": r("../shared/tokens.ts"),
		},
	},
	build: {
		outDir: "../../dist",
		emptyOutDir: true,
	},
	server: {
		port: 5173,
		strictPort: true,
		// Vite root is src/mainview; allow importing src/shared (one level up)
		// and the repo-root shared/ design-tokens package.
		fs: { allow: [r("./"), r("../shared")] },
	},
});
