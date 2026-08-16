#!/usr/bin/env bun
/**
 * Post-build (Windows only): embed the app icon into the installer Setup.exe and
 * rebuild its distributable zip.
 *
 * Electrobun 1.18.1 can't embed the installer icon (broken rcedit resolution) AND
 * the Setup.exe is created after every build hook, so no hook can reach it. We run
 * this right after `electrobun build`: rcedit the loose stub in build/<env>-win-x64/,
 * then re-stage exe + `.installer/` payload and re-zip the artifact. Best-effort.
 *   usage: bun scripts/embed-installer-icon.ts <canary|stable>
 */
import { existsSync, mkdirSync, copyFileSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";

if (process.platform !== "win32") process.exit(0);

const env = (process.argv[2] || "canary").trim();
const root = join(import.meta.dir, "..");
const rcedit = join(root, "node_modules", "rcedit", "bin", "rcedit-x64.exe");
const icon = join(root, "assets", "icon.ico");
const buildDir = join(root, "build", `${env}-win-x64`);
const artifactsDir = join(root, "artifacts");

if (!existsSync(rcedit) || !existsSync(icon) || !existsSync(buildDir)) {
  console.warn("[installer-icon] skipped — missing rcedit, icon, or build dir");
  process.exit(0);
}

const exeName = readdirSync(buildDir).find((f) => /setup.*\.exe$/i.test(f));
if (!exeName) {
  console.warn("[installer-icon] no Setup .exe found");
  process.exit(0);
}
const stem = exeName.replace(/\.exe$/i, "");
const looseExe = join(buildDir, exeName);

const set = (target: string) =>
  Bun.spawnSync([rcedit, target, "--set-icon", icon], { stdio: ["ignore", "ignore", "inherit"] }).exitCode === 0;

// 1) icon the loose Setup stub
if (set(looseExe)) console.log(`[installer-icon] iconed ${exeName}`);
else { console.warn("[installer-icon] rcedit failed on Setup exe"); process.exit(0); }

// 2) rebuild the distributable zip (exe + .installer/ payload) with the iconed exe
const zipName = readdirSync(artifactsDir).find((f) => /setup.*\.zip$/i.test(f));
if (!zipName) { console.warn("[installer-icon] no Setup .zip in artifacts/"); process.exit(0); }

const staging = join(buildDir, "__ziptmp");
rmSync(staging, { recursive: true, force: true });
mkdirSync(join(staging, ".installer"), { recursive: true });
copyFileSync(looseExe, join(staging, exeName));
for (const f of [`${stem}.metadata.json`, `${stem}.tar.zst`]) {
  const src = join(buildDir, f);
  if (existsSync(src)) copyFileSync(src, join(staging, ".installer", f));
}

const zipOut = join(artifactsDir, zipName);
const ps = `$ErrorActionPreference='Stop'; Compress-Archive -Path (Join-Path '${staging}' '*') -DestinationPath '${zipOut}' -Force`;
const r = Bun.spawnSync(["powershell", "-NoProfile", "-Command", ps], { stdio: ["ignore", "ignore", "inherit"] });
rmSync(staging, { recursive: true, force: true });
if (r.exitCode === 0) console.log(`[installer-icon] rebuilt ${zipName} with iconed installer`);
else console.warn(`[installer-icon] zip rebuild failed (exit ${r.exitCode})`);
