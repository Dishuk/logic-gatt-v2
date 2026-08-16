import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			"@": r("./src/mainview"),
			"@shared": r("./src/shared"),
			"@logic-gatt/shared": r("./src/shared/wire.ts"),
		},
	},
	test: {
		globals: true,
		environment: "jsdom",
		include: ["src/mainview/**/*.test.{ts,tsx}"],
		setupFiles: ["src/mainview/__tests__/setup.ts"],
	},
});
