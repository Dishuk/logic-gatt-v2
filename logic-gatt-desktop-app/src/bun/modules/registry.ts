/**
 * Module registry + router.
 *
 * Holds all `DesktopModule`s (built-in + dynamically loaded), tracks the ACTIVE one,
 * and routes the webview's transport RPCs / connect-form actions to it. Two load
 * policies over one mechanism:
 *   - `register()`      — built-in modules the host vouches for (e.g. mobile).
 *   - `loadFromDir()`   — scan a folder and `import()` every self-declaring module.
 *
 * All modules emit device events through a single sink (`deps.broadcast`) which the
 * host forwards to the webview as `deviceEvent`.
 */

import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { MODULE_API_VERSION } from './sdk'
import type {
  DesktopModule,
  ModuleContext,
  ModuleFactory,
  ModuleSettingValues,
  PluginEvent,
  PluginInfo,
  PluginManifest,
} from './sdk'

export interface RegistryDeps {
  /** Sink for device events from any module → forwarded to the webview. */
  broadcast: (event: PluginEvent) => void
}

export class ModuleRegistry {
  private modules = new Map<string, DesktopModule>()
  private activeId: string | null = null

  constructor(private deps: RegistryDeps) {}

  /** Register a built-in module the host constructs directly (e.g. mobile). */
  register(mod: DesktopModule): void {
    this.modules.set(mod.info.id, mod)
  }

  /**
   * Register a module the host imports statically. Shipped builds contain no `.ts`
   * on disk, so bundled plugins must come through here rather than `loadFromDir`.
   * `moduleDir` still points at the plugin's on-disk assets (binaries, data files).
   */
  async registerBuiltin(factory: ModuleFactory, manifest: PluginManifest, moduleDir: string): Promise<void> {
    if (this.modules.has(manifest.id)) throw new Error(`duplicate module id "${manifest.id}"`)
    const instance = await factory(this.makeContext(manifest, moduleDir), manifest)
    this.modules.set(manifest.id, instance)
  }

  private makeContext(manifest: PluginManifest, moduleDir: string): ModuleContext {
    return {
      moduleId: manifest.id,
      moduleDir,
      broadcast: event => this.deps.broadcast(event),
      log: msg => {
        console.log(`[${manifest.id}] ${msg}`)
        this.deps.broadcast({ type: 'log', message: `[${manifest.id}] ${msg}` })
      },
    }
  }

  /** Scan `dir` and dynamically import every subfolder that declares itself properly. */
  async loadFromDir(dir: string): Promise<void> {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return // directory absent → nothing to load
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const moduleDir = path.join(dir, entry.name)
      try {
        await this.loadOne(moduleDir)
      } catch (err) {
        console.error(`[modules] failed to load ${moduleDir}:`, err)
      }
    }
  }

  private async loadOne(moduleDir: string): Promise<void> {
    const manifestPath = path.join(moduleDir, 'manifest.json')
    let rawManifest: string
    try {
      rawManifest = await fs.readFile(manifestPath, 'utf-8')
    } catch {
      // Not a module directory. A shipped build copies only a module's assets (e.g.
      // usb-ble/bin), leaving a manifest-less folder here.
      return
    }
    const manifest = JSON.parse(rawManifest) as PluginManifest

    if (!manifest.id || !manifest.name || !manifest.version) {
      throw new Error('manifest missing id/name/version')
    }
    if ((manifest.apiVersion ?? 0) !== MODULE_API_VERSION) {
      throw new Error(`apiVersion ${manifest.apiVersion} != host ${MODULE_API_VERSION}`)
    }
    if (this.modules.has(manifest.id)) {
      console.log(`[modules] ${manifest.id} already registered — skipping folder copy`)
      return
    }

    // Prefer index.js (shipped/compiled); fall back to index.ts, which Bun imports directly.
    const entry = ['index.js', 'index.ts'].map(f => path.join(moduleDir, f)).find(f => existsSync(f))
    if (!entry) throw new Error(`"${manifest.id}" has no index.js or index.ts`)

    const mod = (await import(pathToFileURL(entry).href)) as { default?: ModuleFactory }
    const factory = mod.default
    if (typeof factory !== 'function') {
      throw new Error(`"${manifest.id}" must default-export a ModuleFactory`)
    }

    const instance = await factory(this.makeContext(manifest, moduleDir), manifest)
    this.modules.set(manifest.id, instance)
    console.log(`[modules] loaded ${manifest.id} (${manifest.name} v${manifest.version})`)
  }

  /** Menu list — default module first, then registration order. */
  list(): PluginInfo[] {
    return [...this.modules.values()]
      .map(m => m.info)
      .sort((a, b) => Number(Boolean(b.isDefault)) - Number(Boolean(a.isDefault)))
  }

  get(id: string): DesktopModule | null {
    return this.modules.get(id) ?? null
  }

  /** Hand a module the user's values for its declared settings. Unknown ids are ignored. */
  async applySettings(id: string, values: ModuleSettingValues): Promise<void> {
    await this.modules.get(id)?.applySettings?.(values)
  }

  active(): DesktopModule | null {
    return this.activeId ? (this.modules.get(this.activeId) ?? null) : null
  }

  /** Make `id` active: deselect the previous module, then select the new one. */
  async select(id: string): Promise<PluginInfo | null> {
    const next = this.modules.get(id)
    if (!next) return null
    const prev = this.active()
    if (prev && prev.info.id !== id) await prev.deselect()
    this.activeId = id
    await next.select()
    return next.info
  }
}
