#!/usr/bin/env bun
/**
 * preBuild hook: stage the packages listed in `build.bun.external` (plus their runtime
 * dependency closure) into vendor/node_modules, which `build.copy` then places next to
 * the bundled entrypoint so Bun can resolve them from disk at runtime.
 *
 * `serialport` cannot be bundled. Bun's bundler breaks it twice:
 *   - `require("@serialport/bindings-interface")` — an empty CJS module — is elided down
 *     to `__exportStar(, exports)`, a syntax error that kills the Bun process at parse
 *     time, before the window is created.
 *   - the native binding's `__dirname` is inlined as an absolute path, so node-gyp-build
 *     looks for prebuilds/ under a directory that exists only on the build machine.
 * Both disappear when the package stays on disk as a real node_modules tree.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import config from '../electrobun.config'

const external = config.build?.bun?.external ?? []
const root = join(import.meta.dir, '..')
const topModules = join(root, 'node_modules')
const dest = join(root, 'vendor', 'node_modules')
const stamp = join(root, 'vendor', 'staged.json')

/** Node resolution for a package folder: walk up looking for node_modules/<name>. */
function packageDir(name: string, fromDir: string): string | null {
  for (let dir = fromDir; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return candidate
    if (dirname(dir) === dir) return null
  }
}

// Walk the closure. Only top-level packages are staged — anything resolved from a nested
// node_modules already travels inside its parent's copy, and staging it flat would clash
// with the top-level version of the same name.
const toStage = new Map<string, { dir: string; version: string }>()
const visited = new Set<string>()
const queue = external.map(name => ({ name, fromDir: root }))

while (queue.length > 0) {
  const { name, fromDir } = queue.shift()!
  const dir = packageDir(name, fromDir)
  if (!dir) {
    console.warn(`[stage-external-deps] cannot resolve "${name}" from ${fromDir}`)
    continue
  }
  if (visited.has(dir)) continue
  visited.add(dir)

  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  if (dir === join(topModules, name)) toStage.set(name, { dir, version: pkg.version })
  for (const dep of Object.keys(pkg.dependencies ?? {})) queue.push({ name: dep, fromDir: dir })
}

const key = [...toStage]
  .map(([name, p]) => `${name}@${p.version}`)
  .sort()
  .join('\n')
if (existsSync(stamp) && readFileSync(stamp, 'utf8') === key) {
  console.log(`[stage-external-deps] up to date (${toStage.size} packages)`)
  process.exit(0)
}

rmSync(dest, { recursive: true, force: true })
mkdirSync(dest, { recursive: true })
for (const [name, { dir }] of toStage) {
  const target = join(dest, name)
  mkdirSync(dirname(target), { recursive: true })
  cpSync(dir, target, { recursive: true, dereference: true })
}
writeFileSync(stamp, key)
console.log(`[stage-external-deps] staged ${toStage.size} packages: ${[...toStage.keys()].join(', ')}`)
