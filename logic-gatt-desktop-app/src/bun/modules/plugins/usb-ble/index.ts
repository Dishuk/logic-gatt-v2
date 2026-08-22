/**
 * usb-ble module (ported from the old backend plugin, as-is).
 *
 * Spawns and manages a Python `bless` backend that drives the PC's Bluetooth adapter
 * as a BLE peripheral, and forwards commands/events between the desktop and that
 * process over a local WebSocket. Adapted to the v2 module SDK: extends the SDK
 * `PluginBase`; route handlers are `(body) => result` (were Express `(req,res)`); the
 * Python WS port is 8766 (8765 belongs to the mobile Wi-Fi transport).
 */

import { ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import WebSocket from "ws";

import { PluginBase, pluginToModule } from "../../sdk";
import type {
	ModuleContext,
	ModuleFactory,
	ModuleSettingDef,
	ModuleSettingValues,
	PluginRoute,
	Schema,
	DeviceSettings,
} from "../../sdk";

const PYTHON_WS_PORT = 8766;
const PYTHON_WS_URL = `ws://localhost:${PYTHON_WS_PORT}`;
const CONNECTION_TIMEOUT_MS = 5000;
/** How long to wait for Python process to start before connecting */
const PYTHON_STARTUP_DELAY_MS = 1500;
/** Polling interval when waiting for connection to complete */
const CONNECTION_POLL_INTERVAL_MS = 100;
/** Timeout for SIGTERM before sending SIGKILL */
const PROCESS_KILL_TIMEOUT_MS = 3000;
/** Longer timeout for Python backend (process + BLE stack overhead) */
const ACK_TIMEOUT_MS = 5000;

interface PythonMessage {
	type: string;
	requestId?: string;
	[key: string]: unknown;
}

interface PendingRequest {
	resolve: () => void;
	reject: (err: Error) => void;
	timeoutId: ReturnType<typeof setTimeout>;
}

class UsbBlePlugin extends PluginBase {
	private pythonProcess: ChildProcess | null = null;
	private pythonWs: WebSocket | null = null;
	private pendingRequests = new Map<string, PendingRequest>();
	private pythonBackendPath: string;
	private bridgeBinaryPath: string;
	private exitGuard: (() => void) | null = null;
	/** Off by default: renaming the adapter mutates the host system (see getSettings). */
	private overwriteAdapterName = false;
	private isConnecting = false;
	private isUploading = false;
	private requestIdCounter = 0;

	constructor(context: ModuleContext) {
		super(context);
		// Python backend ships in python/ within this module's directory.
		this.pythonBackendPath = path.join(context.moduleDir, "python");
		this.bridgeBinaryPath = path.join(
			context.moduleDir,
			"bin",
			process.platform === "win32" ? "logicgatt-blebridge.exe" : "logicgatt-blebridge",
		);
	}

	/** Frozen bridge if present (shipped builds), else the dev venv interpreter + main.py. */
	private resolveBackendCommand(): { cmd: string; args: string[]; cwd: string } | null {
		if (fs.existsSync(this.bridgeBinaryPath)) {
			// Packaging round-trips can drop the exec bit; restore it before spawning.
			if (process.platform !== "win32") {
				try {
					fs.chmodSync(this.bridgeBinaryPath, 0o755);
				} catch {
					/* best effort */
				}
			}
			// python/ is not shipped alongside the frozen binary, so anchor cwd to bin/.
			return { cmd: this.bridgeBinaryPath, args: [], cwd: path.dirname(this.bridgeBinaryPath) };
		}
		const venvPython =
			process.platform === "win32"
				? path.join(this.pythonBackendPath, "venv", "Scripts", "python.exe")
				: path.join(this.pythonBackendPath, "venv", "bin", "python");
		const mainScript = path.join(this.pythonBackendPath, "main.py");
		if (fs.existsSync(venvPython) && fs.existsSync(mainScript)) {
			return { cmd: venvPython, args: [mainScript], cwd: this.pythonBackendPath };
		}
		return null;
	}

	private generateRequestId(): string {
		return `req-${++this.requestIdCounter}-${Date.now()}`;
	}

	async onLoad(): Promise<void> {
		this.ctx.log("PC Bluetooth adapter ready");
	}

	async onUnload(): Promise<void> {
		await this.cleanup();
		this.ctx.log("PC Bluetooth adapter released");
	}

	// Windows and Linux only — bless has no macOS peripheral backend we ship for.
	isAvailable(): boolean {
		if (process.platform !== "win32" && process.platform !== "linux") return false;
		return this.resolveBackendCommand() !== null;
	}

	getSettings(): ModuleSettingDef[] {
		return [
			{
				id: "overwriteAdapterName",
				label: "Apply the device name to the Bluetooth adapter",
				description:
					"Windows advertises this computer's Bluetooth name, so the project's Device Name is ignored. " +
					"Enabling this renames the adapter for all Bluetooth use, not just this app — it needs " +
					"Administrator and stays in effect after the app closes.",
				type: "boolean",
				default: false,
				platforms: ["win32"],
			},
		];
	}

	onSettingsChanged(values: ModuleSettingValues): void {
		this.overwriteAdapterName = values.overwriteAdapterName === true;
	}

	getRoutes(): PluginRoute[] {
		return [
			{
				method: "GET",
				path: "/status",
				label: "Adapter Status",
				description: "Whether the Bluetooth adapter is running",
				ui: { display: "status", fieldId: "backend", fieldLabel: "Bluetooth adapter", refreshMs: 2000 },
				handler: () => {
					const isRunning = this.pythonProcess !== null && !this.pythonProcess.killed;
					const isConnected = this.pythonWs !== null && this.pythonWs.readyState === WebSocket.OPEN;
					return { running: isRunning, wsConnected: isConnected, pid: this.pythonProcess?.pid };
				},
			},
			{
				method: "POST",
				path: "/start-backend",
				label: "Start Adapter",
				description: "Start the Bluetooth adapter",
				ui: { display: "status-start", fieldId: "backend" },
				handler: async () => {
					await this.startPythonBackend();
					return { success: true, running: true };
				},
			},
			{
				method: "POST",
				path: "/stop-backend",
				label: "Stop Adapter",
				description: "Stop the Bluetooth adapter",
				ui: { display: "status-stop", fieldId: "backend" },
				handler: async () => {
					await this.stopPythonBackend();
					return { success: true, running: false };
				},
			},
		];
	}

	async onUploadSchema(schema: Schema, settings: DeviceSettings): Promise<void> {
		if (this.isUploading) throw new Error("Schema upload already in progress");
		this.isUploading = true;

		try {
			if (!this.pythonWs || this.pythonWs.readyState !== WebSocket.OPEN) {
				await this.startPythonBackend();
			}

			const backendSchema = {
				services: schema.services.map((svc) => ({
					uuid: svc.uuid,
					characteristics: svc.characteristics.map((chr) => ({
						uuid: chr.uuid,
						properties: chr.properties,
						defaultValue: chr.defaultValue,
					})),
				})),
			};

			this.ctx.log("Uploading schema to the Bluetooth adapter…");
			await this.sendToPython({
				type: "upload-schema",
				requestId: this.generateRequestId(),
				schema: backendSchema,
				settings: {
					deviceName: settings.deviceName,
					appearance: settings.appearance ?? 0,
					manufacturerData: settings.manufacturerData ?? [],
					nameOverwrite: this.overwriteAdapterName,
				},
			});
			this.ctx.log("Schema uploaded");

			this.ctx.log("Starting BLE advertising...");
			await this.sendToPython({ type: "start-advertising", requestId: this.generateRequestId() });
			this.ctx.log(`Advertising as "${settings.deviceName}"`);
		} finally {
			this.isUploading = false;
		}
	}

	async onConnect(): Promise<void> {
		if (!this.pythonWs || this.pythonWs.readyState !== WebSocket.OPEN) {
			await this.startPythonBackend();
		}
		this.ctx.broadcast({ type: "connected" });
	}

	async onDisconnect(): Promise<void> {
		if (this.pythonWs && this.pythonWs.readyState === WebSocket.OPEN) {
			try {
				this.pythonWs.send(JSON.stringify({ type: "disconnect", requestId: this.generateRequestId() }));
			} catch (err) {
				this.ctx.log(`Disconnect send failed (socket may be closed): ${err instanceof Error ? err.message : err}`);
			}
		}
		this.ctx.broadcast({ type: "disconnected" });
	}

	async onNotify(serviceUuid: string, charUuid: string, data: Uint8Array): Promise<void> {
		if (!this.pythonWs || this.pythonWs.readyState !== WebSocket.OPEN) {
			throw new Error("Bluetooth adapter is not connected");
		}
		await this.sendToPython({
			type: "notify",
			requestId: this.generateRequestId(),
			serviceUuid,
			charUuid,
			data: Array.from(data),
		});
	}

	async onRespondToRead(serviceUuid: string, charUuid: string, data: Uint8Array): Promise<void> {
		if (!this.pythonWs || this.pythonWs.readyState !== WebSocket.OPEN) {
			throw new Error("Bluetooth adapter is not connected");
		}
		await this.sendToPython({
			type: "respond-to-read",
			requestId: this.generateRequestId(),
			serviceUuid,
			charUuid,
			data: Array.from(data),
		});
	}

	private async startPythonBackend(): Promise<void> {
		if (this.isConnecting) {
			this.ctx.log("Connection already in progress, waiting...");
			await new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => {
					clearInterval(checkInterval);
					reject(new Error("Timeout waiting for connection to complete"));
				}, CONNECTION_TIMEOUT_MS);
				const checkInterval = setInterval(() => {
					if (!this.isConnecting) {
						clearInterval(checkInterval);
						clearTimeout(timeout);
						resolve();
					}
				}, CONNECTION_POLL_INTERVAL_MS);
			});
			return;
		}

		if (this.pythonProcess && !this.pythonProcess.killed) {
			this.ctx.log("Bluetooth adapter already running");
			if (!this.pythonWs || this.pythonWs.readyState !== WebSocket.OPEN) {
				await this.connectToPythonWs();
			}
			return;
		}

		this.isConnecting = true;

		try {
			const backend = this.resolveBackendCommand();
			if (!backend) {
				throw new Error(
					"Bluetooth adapter support is not installed in this build.",
				);
			}
			this.ctx.log("Starting the Bluetooth adapter…");

			// stdin is piped and never written to: the bridge watches it for EOF and exits
			// when this process dies. Quitting the app never runs deselect, and an orphaned
			// bridge would hold port 8766 against the next launch.
			this.pythonProcess = spawn(backend.cmd, backend.args, {
				cwd: backend.cwd,
				stdio: ["pipe", "pipe", "pipe"],
			});

			this.exitGuard = () => {
				try {
					this.pythonProcess?.kill();
				} catch {
					/* best effort */
				}
			};
			process.once("exit", this.exitGuard);

			// Both streams are tagged the same: Python's logging writes to stderr, so
			// labelling that as an error would mark every INFO line as a failure.
			const relay = (data: Buffer) => {
				for (const line of data.toString().trim().split("\n")) this.ctx.log(`[adapter] ${line}`);
			};
			this.pythonProcess.stdout?.on("data", relay);
			this.pythonProcess.stderr?.on("data", relay);
			this.pythonProcess.on("exit", (code) => {
				this.ctx.log(code ? `Bluetooth adapter stopped (code ${code})` : "Bluetooth adapter stopped");
				this.clearExitGuard();
				this.pythonProcess = null;
				if (this.pythonWs) {
					this.pythonWs.close();
					this.pythonWs = null;
				}
				this.clearPendingRequests(new Error("Bluetooth adapter stopped"));
				this.ctx.broadcast({ type: "disconnected", reason: "Bluetooth adapter stopped" });
			});
			this.pythonProcess.on("error", (err) => {
				this.ctx.log(`Bluetooth adapter error: ${err.message}`);
				this.pythonProcess = null;
			});

			await new Promise((r) => setTimeout(r, PYTHON_STARTUP_DELAY_MS));
			// The exit handler nulls this. Without the check we would happily connect to
			// whatever else is on the port — e.g. a stale bridge from an earlier session,
			// silently running a different build.
			if (!this.pythonProcess) {
				throw new Error(
					"The Bluetooth adapter could not start — another instance of the app may already be using it.",
				);
			}
			await this.connectToPythonWs();
		} finally {
			this.isConnecting = false;
		}
	}

	private clearPendingRequests(error: Error): void {
		for (const [, request] of this.pendingRequests) {
			clearTimeout(request.timeoutId);
			request.reject(error);
		}
		this.pendingRequests.clear();
	}

	private async connectToPythonWs(): Promise<void> {
		return new Promise((resolve, reject) => {
			this.ctx.log("Connecting to the Bluetooth adapter…");
			const ws = new WebSocket(PYTHON_WS_URL);
			const timeout = setTimeout(() => {
				ws.close();
				reject(new Error("Timed out connecting to the Bluetooth adapter"));
			}, CONNECTION_TIMEOUT_MS);

			ws.on("open", () => {
				clearTimeout(timeout);
				this.ctx.log("Connected to the Bluetooth adapter");
				this.pythonWs = ws;
				resolve();
			});
			ws.on("error", (err) => {
				clearTimeout(timeout);
				reject(new Error(`Bluetooth adapter connection error: ${err.message}`));
			});
			ws.on("close", () => {
				this.ctx.log("Bluetooth adapter connection closed");
				this.pythonWs = null;
				this.clearPendingRequests(new Error("Bluetooth adapter connection closed"));
			});
			ws.on("message", (data: Buffer) => {
				try {
					this.handlePythonMessage(JSON.parse(data.toString()) as PythonMessage);
				} catch (err) {
					this.ctx.log(`Unreadable message from the Bluetooth adapter: ${err}`);
				}
			});
		});
	}

	private handlePythonMessage(msg: PythonMessage): void {
		switch (msg.type) {
			case "ack":
			case "nack": {
				const pending = this.pendingRequests.get(msg.requestId || "");
				if (pending) {
					this.pendingRequests.delete(msg.requestId || "");
					if (msg.type === "ack") pending.resolve();
					else pending.reject(new Error((msg.error as string) || "NACK"));
				}
				break;
			}
			case "pong":
				break;
			case "char-write-event":
				this.ctx.broadcast({
					type: "char-write",
					serviceUuid: msg.serviceUuid as string,
					charUuid: msg.charUuid as string,
					data: msg.data as number[],
				});
				break;
			case "char-read-event":
				this.ctx.broadcast({
					type: "char-read",
					serviceUuid: msg.serviceUuid as string,
					charUuid: msg.charUuid as string,
				});
				break;
			case "connected":
				this.ctx.broadcast({ type: "connected" });
				break;
			case "disconnected":
				this.ctx.broadcast({ type: "disconnected", reason: msg.reason as string | undefined });
				break;
			case "error":
				this.ctx.broadcast({ type: "error", message: msg.message as string });
				break;
			default:
				this.ctx.log(`Unexpected message from the Bluetooth adapter: ${msg.type}`);
		}
	}

	private async sendToPython(msg: PythonMessage): Promise<void> {
		if (!this.pythonWs || this.pythonWs.readyState !== WebSocket.OPEN) {
			throw new Error("Bluetooth adapter is not connected");
		}
		return new Promise((resolve, reject) => {
			const requestId = msg.requestId || this.generateRequestId();
			msg.requestId = requestId;
			const timeoutId = setTimeout(() => {
				this.pendingRequests.delete(requestId);
				reject(new Error(`Timeout waiting for ACK (${msg.type})`));
			}, ACK_TIMEOUT_MS);
			this.pendingRequests.set(requestId, {
				resolve: () => {
					clearTimeout(timeoutId);
					resolve();
				},
				reject: (err) => {
					clearTimeout(timeoutId);
					reject(err);
				},
				timeoutId,
			});
			this.pythonWs!.send(JSON.stringify(msg));
		});
	}

	private clearExitGuard(): void {
		if (!this.exitGuard) return;
		process.off("exit", this.exitGuard);
		this.exitGuard = null;
	}

	private async stopPythonBackend(): Promise<void> {
		this.clearExitGuard();
		if (this.pythonWs) {
			try {
				this.pythonWs.close();
			} catch (err) {
				this.ctx.log(`Could not close the adapter connection: ${err instanceof Error ? err.message : err}`);
			}
			this.pythonWs = null;
		}
		if (this.pythonProcess && !this.pythonProcess.killed) {
			this.ctx.log("Stopping the Bluetooth adapter…");
			this.pythonProcess.kill("SIGTERM");
			await new Promise<void>((resolve) => {
				const timeout = setTimeout(() => {
					if (this.pythonProcess && !this.pythonProcess.killed) this.pythonProcess.kill("SIGKILL");
					resolve();
				}, PROCESS_KILL_TIMEOUT_MS);
				this.pythonProcess!.once("exit", () => {
					clearTimeout(timeout);
					resolve();
				});
			});
			this.pythonProcess = null;
		}
	}

	private async cleanup(): Promise<void> {
		this.clearPendingRequests(new Error("Bluetooth adapter released"));
		await this.stopPythonBackend();
	}
}

const factory: ModuleFactory = (ctx, manifest) => pluginToModule(new UsbBlePlugin(ctx), manifest);
export default factory;
