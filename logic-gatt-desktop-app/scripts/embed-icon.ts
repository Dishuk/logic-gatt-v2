#!/usr/bin/env bun
/**
 * postBuild hook: embed the Windows app icon AND version metadata ourselves.
 *
 * Electrobun 1.18.1 tries to embed `build.win.icon` via rcedit but fails to
 * resolve rcedit from its compiled CLI ("Cannot find module rcedit"). rcedit IS
 * in our node_modules, so we do it. postBuild runs after the app bundle is
 * assembled but BEFORE it's compressed into the installer tarball, so the loose
 * launcher.exe / bun.exe are still on disk under the build dir — glob for them
 * and set the icon so the INSTALLED app (esp. the bun.exe window process) shows
 * it. Best-effort: never fail the build.
 *
 * We also overwrite the PE version resource. The bundled bun.exe is the stock
 * Bun runtime (ProductName=Bun, CompanyName=Oven) and it's the process that
 * hosts our WebSocket server + mDNS — so Windows' firewall prompt reads that
 * resource and says "Bun" / "Oven". Rebranding it to LogicGATT / Dishuk makes
 * the prompt name the actual app. (This does NOT make the app a verified
 * publisher — that needs Authenticode code signing.)
 */
import { Glob } from "bun";
import { existsSync, readSync, openSync, closeSync, readFileSync } from "node:fs";
import { join } from "node:path";

if (process.env.ELECTROBUN_OS !== "win") process.exit(0);

const root = join(import.meta.dir, ".."); // logic-gatt-desktop-app
const icon = join(root, "assets", "icon.ico");
const rcedit = join(root, "node_modules", "rcedit", "bin", "rcedit-x64.exe");
const buildDir = process.env.ELECTROBUN_BUILD_DIR;

const version: string = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
).version;

// Version-resource strings shared by every branded exe.
const versionArgs = [
  "--set-version-string", "ProductName", "LogicGATT",
  "--set-version-string", "CompanyName", "Dishuk",
  "--set-version-string", "FileDescription", "LogicGATT",
  "--set-version-string", "LegalCopyright", "© Dishuk",
  "--set-version-string", "OriginalFilename", "LogicGATT.exe",
  "--set-product-version", version,
  "--set-file-version", version,
];

if (!existsSync(icon) || !existsSync(rcedit) || !buildDir || !existsSync(buildDir)) {
  console.warn("[embed-icon] skipped — missing icon, rcedit, or build dir");
  process.exit(0);
}

function isPE(file: string): boolean {
  try {
    const fd = openSync(file, "r");
    const buf = Buffer.alloc(2);
    readSync(fd, buf, 0, 2, 0);
    closeSync(fd);
    return buf[0] === 0x4d && buf[1] === 0x5a; // "MZ"
  } catch {
    return false;
  }
}

const glob = new Glob("**/{bun.exe,launcher.exe,launcher}");
let done = 0;
for (const rel of glob.scanSync({ cwd: buildDir, onlyFiles: true })) {
  const target = join(buildDir, rel);
  if (!isPE(target)) continue;
  const r = Bun.spawnSync([rcedit, target, "--set-icon", icon, ...versionArgs], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  if (r.exitCode === 0) {
    console.log(`[embed-icon] branded ${rel} (icon + version)`);
    done++;
  } else {
    console.warn(`[embed-icon] rcedit failed on ${rel} (exit ${r.exitCode})`);
  }
}
console.log(`[embed-icon] done — branded ${done} executable(s) as LogicGATT v${version}`);
