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
	private isConnecting = false;
	private isUploading = false;
	private requestIdCounter = 0;

	constructor(context: ModuleContext) {
		super(context);
		// Python backend ships in python/ within this module's directory.
		this.pythonBackendPath = path.join(context.moduleDir, "python");
	}

	private generateRequestId(): string {
		return `req-${++this.requestIdCounter}-${Date.now()}`;
	}

	async onLoad(): Promise<void> {
		this.ctx.log("USB BLE plugin loaded");
		this.ctx.log(`Python backend path: ${this.pythonBackendPath}`);
	}

	async onUnload(): Promise<void> {
		await this.cleanup();
		this.ctx.log("USB BLE plugin unloaded");
	}

	isAvailable(): boolean {
		return true;
	}

	getRoutes(): PluginRoute[] {
		return [
			{
				method: "GET",
				path: "/status",
				label: "Backend Status",
				description: "Get Python backend process status",
				ui: { display: "status", fieldId: "backend", fieldLabel: "Python Backend", refreshMs: 2000 },
				handler: () => {
					const isRunning = this.pythonProcess !== null && !this.pythonProcess.killed;
					const isConnected = this.pythonWs !== null && this.pythonWs.readyState === WebSocket.OPEN;
					return { running: isRunning, wsConnected: isConnected, pid: this.pythonProcess?.pid };
				},
			},
			{
				method: "POST",
				path: "/start-backend",
				label: "Start Backend",
				description: "Start the Python BLE backend process",
				ui: { display: "status-start", fieldId: "backend" },
				handler: async () => {
					await this.startPythonBackend();
					return { success: true, running: true };
				},
			},
			{
				method: "POST",
				path: "/stop-backend",
				label: "Stop Backend",
				description: "Stop the Python BLE backend process",
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
				this.ctx.log("Starting Python backend...");
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

			this.ctx.log("Uploading schema to Python backend...");
			await this.sendToPython({
				type: "upload-schema",
				requestId: this.generateRequestId(),
				schema: backendSchema,
				settings: {
					deviceName: settings.deviceName,
					appearance: settings.appearance ?? 0,
					manufacturerData: settings.manufacturerData ?? [],
				},
			});
			this.ctx.log("Schema uploaded to Python backend");

			this.ctx.log("Starting BLE advertising...");
			await this.sendToPython({ type: "start-advertising", requestId: this.generateRequestId() });
			this.ctx.log(`Advertising as "${settings.deviceName}"`);
		} finally {
			this.isUploading = false;
		}
	}

	async onConnect(): Promise<void> {
		if (!this.pythonWs || this.pythonWs.readyState !== WebSocket.OPEN) {
			this.ctx.log("Starting Python backend for connect...");
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
			throw new Error("Python backend not connected");
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
			throw new Error("Python backend not connected");
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
			this.ctx.log("Python backend already running");
			if (!this.pythonWs || this.pythonWs.readyState !== WebSocket.OPEN) {
				await this.connectToPythonWs();
			}
			return;
		}

		this.isConnecting = true;

		try {
			this.ctx.log("Starting Python backend process...");
			const venvPython =
				process.platform === "win32"
					? path.join(this.pythonBackendPath, "venv", "Scripts", "python.exe")
					: path.join(this.pythonBackendPath, "venv", "bin", "python");
			const pythonCmd = fs.existsSync(venvPython) ? venvPython : "python3";
			const mainScript = path.join(this.pythonBackendPath, "main.py");

			this.pythonProcess = spawn(pythonCmd, [mainScript], {
				cwd: this.pythonBackendPath,
				stdio: ["ignore", "pipe", "pipe"],
			});

			this.pythonProcess.stdout?.on("data", (data: Buffer) => {
				for (const line of data.toString().trim().split("\n")) this.ctx.log(`[Python] ${line}`);
			});
			this.pythonProcess.stderr?.on("data", (data: Buffer) => {
				for (const line of data.toString().trim().split("\n")) this.ctx.log(`[Python ERR] ${line}`);
			});
			this.pythonProcess.on("exit", (code) => {
				this.ctx.log(`Python backend exited with code ${code}`);
				this.pythonProcess = null;
				if (this.pythonWs) {
					this.pythonWs.close();
					this.pythonWs = null;
				}
				this.clearPendingRequests(new Error("Python backend exited"));
				this.ctx.broadcast({ type: "disconnected", reason: "Python backend exited" });
			});
			this.pythonProcess.on("error", (err) => {
				this.ctx.log(`Python backend error: ${err.message}`);
				this.pythonProcess = null;
			});

			await new Promise((r) => setTimeout(r, PYTHON_STARTUP_DELAY_MS));
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
			this.ctx.log(`Connecting to Python WebSocket at ${PYTHON_WS_URL}...`);
			const ws = new WebSocket(PYTHON_WS_URL);
			const timeout = setTimeout(() => {
				ws.close();
				reject(new Error("Python WebSocket connection timeout"));
			}, CONNECTION_TIMEOUT_MS);

			ws.on("open", () => {
				clearTimeout(timeout);
				this.ctx.log("Connected to Python backend WebSocket");
				this.pythonWs = ws;
				resolve();
			});
			ws.on("error", (err) => {
				clearTimeout(timeout);
				reject(new Error(`Python WebSocket error: ${err.message}`));
			});
			ws.on("close", () => {
				this.ctx.log("Python WebSocket closed");
				this.pythonWs = null;
				this.clearPendingRequests(new Error("WebSocket connection closed"));
			});
			ws.on("message", (data: Buffer) => {
				try {
					this.handlePythonMessage(JSON.parse(data.toString()) as PythonMessage);
				} catch (err) {
					this.ctx.log(`Failed to parse Python message: ${err}`);
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
				this.ctx.log(`Unknown Python message type: ${msg.type}`);
		}
	}

	private async sendToPython(msg: PythonMessage): Promise<void> {
		if (!this.pythonWs || this.pythonWs.readyState !== WebSocket.OPEN) {
			throw new Error("Python WebSocket not connected");
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

	private async stopPythonBackend(): Promise<void> {
		if (this.pythonWs) {
			try {
				this.pythonWs.close();
			} catch (err) {
				this.ctx.log(`WebSocket close failed: ${err instanceof Error ? err.message : err}`);
			}
			this.pythonWs = null;
		}
		if (this.pythonProcess && !this.pythonProcess.killed) {
			this.ctx.log("Stopping Python backend process...");
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
			this.ctx.log("Python backend stopped");
		}
	}

	private async cleanup(): Promise<void> {
		this.clearPendingRequests(new Error("Plugin unloaded"));
		await this.stopPythonBackend();
	}
}

const factory: ModuleFactory = (ctx, manifest) => pluginToModule(new UsbBlePlugin(ctx), manifest);
export default factory;
