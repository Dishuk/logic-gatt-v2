/**
 * RPC contract between the webview and the Bun main process.
 *
 * Shared by both sides. Structured to satisfy electrobun's `ElectrobunRPCSchema`
 * (`{ bun, webview }`, each with `requests` + `messages`). Convention (see
 * electrobun `defineElectrobunRPC`):
 *   - `bun.requests`     = requests HANDLED BY bun     (the webview calls them)
 *   - `webview.messages` = messages HANDLED BY webview (bun sends them)
 *
 * Kept free of any electrobun import so it is safe to load on both sides.
 */

import type {
  PluginEvent,
  PluginInfo,
  ModuleSettingValues,
  Schema as WireSchema,
  DeviceSettings as WireDeviceSettings,
} from './wire'

type Req<P, R> = { params: P; response: R }

/** Severity for a log line. Mirrors `LogLevel` in `bun/logger.ts` (kept local so this
 * shared file never imports the Bun-only logger). */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** A peer that connected without the session token and needs the user's decision. */
export type PendingPeer = { peerId: string; address: string }

/** Info the webview needs to render the QR / show the address. */
export type ConnectionInfo = {
  /**
   * The address plus this run's session token. Encode it in the QR — it is what the
   * phone must present to be adopted without a prompt. Never print it.
   */
  url: string
  /** The bare `ws://host:port`, safe to show on screen and in logs. */
  displayUrl: string
  host: string
  port: number
  localName: string
  /**
   * The currently-connected executor (phone), or null if none. A snapshot so the
   * connect UI can adopt a peer that connected *before* the modal was opened
   * (e.g. a reconnect), not only ones that arrive via a live `peer-connected`.
   */
  peerId: string | null
  /** Snapshot of a peer awaiting approval, for the same reason as `peerId`. */
  pendingPeer: PendingPeer | null
}

/** A project file the webview opened or saved: its absolute path and contents. */
export type ProjectFile = { path: string; contents: string }

/** Connection-flow events pushed from Bun to the webview (ping/pong milestone). */
export type ConnectionEvent =
  | { type: 'server-listening'; url: string; host: string; port: number }
  | { type: 'peer-connected'; peerId: string }
  | { type: 'peer-disconnected'; peerId: string }
  /** A tokenless peer is waiting for the user to allow or deny it. */
  | { type: 'peer-pending'; peerId: string; address: string }
  /** A waiting peer was denied, timed out, or gave up. Clears the prompt. */
  | { type: 'peer-denied'; peerId: string }
  | { type: 'ping'; peerId: string; seq: number }
  | { type: 'pong'; peerId: string; seq: number }
  | { type: 'log'; message: string }

export type DesktopRPCSchema = {
  bun: {
    requests: {
      // connection flow (QR + mDNS + ping/pong milestone)
      getConnectionInfo: Req<void, ConnectionInfo>
      /** Adopt a peer that connected without the session token (mDNS path). */
      approvePeer: Req<{ peerId: string }, void>
      /** Refuse a peer awaiting approval and close its socket. */
      denyPeer: Req<{ peerId: string }, void>
      // transport lifecycle. `connect` opens the link for INITIATE modules (serial /
      // local backend); it is a no-op for the mobile module (the phone dials in and
      // is auto-adopted). `disconnect` ends the session for any module.
      connect: Req<void, void>
      uploadSchema: Req<{ schema: WireSchema; settings: WireDeviceSettings }, void>
      notify: Req<{ serviceUuid: string; charUuid: string; data: number[] }, void>
      respondToRead: Req<{ serviceUuid: string; charUuid: string; data: number[] }, void>
      // Stop the emulated device but keep the link (Stop). `disconnect` = full teardown.
      stopDevice: Req<void, void>
      disconnect: Req<void, void>
      // modules (ex-"plugins")
      listModules: Req<void, PluginInfo[]>
      selectModule: Req<{ moduleId: string }, PluginInfo | null>
      callModuleAction: Req<{ moduleId: string; method: string; path: string; body?: unknown }, unknown>
      /** Push the user's values for a module's declared settings (see PluginInfo.settings). */
      setModuleSettings: Req<{ moduleId: string; values: ModuleSettingValues }, void>
      // presets
      getPresets: Req<void, string[]>
      getPreset: Req<{ name: string }, unknown>
      // project files. The webview has no filesystem access (a Blob download is all
      // it can do), so every read/write goes through Bun. `null` = the user cancelled
      // the dialog; a genuine failure rejects instead.
      openProjectFile: Req<void, ProjectFile | null>
      /** Overwrite an existing path — no dialog. Used by Save on a titled project. */
      writeProjectFile: Req<{ path: string; contents: string }, void>
      /** Directory picker for Save As (electrobun 1.18.1 has no save dialog). */
      pickProjectDirectory: Req<void, string | null>
      /** Join dir + filename Bun-side and reject a name that escapes the directory. */
      resolveProjectPath: Req<{ dir: string; name: string }, { path: string; exists: boolean }>
      // Called once the webview has mounted so Bun can nudge the window size — the
      // webview is created at the OUTER frame size and only corrects to the client
      // area on a real resize event (see index.ts).
      fitWindow: Req<void, void>
      // logging: the webview ships its own errors/warnings here so they land in the
      // single Bun-side session log file (the webview can't write files itself).
      log: Req<{ level: LogLevel; source: string; message: string }, void>
      // reveal the logs directory in the OS file manager (the "Open logs folder" button).
      openLogsFolder: Req<void, { dir: string } | null>
      // open an external URL in the user's default browser (doc links). The webview
      // can't navigate away safely, so this hands off to the OS.
      openExternal: Req<{ url: string }, void>
    }
    messages: Record<never, never>
  }
  webview: {
    requests: Record<never, never>
    messages: {
      /** Bun -> webview device event stream. */
      deviceEvent: PluginEvent
      /** Bun -> webview connection-flow events. */
      connectionEvent: ConnectionEvent
    }
  }
}

/** Bun -> webview push message payload. */
export type DeviceEvent = PluginEvent
