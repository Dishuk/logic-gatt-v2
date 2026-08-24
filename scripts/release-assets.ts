// Shared vocabulary for the release steps: where the current version comes from,
// where staged assets live, and how a host's build output maps to a release asset.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const root = join(import.meta.dir, '..');

const DESKTOP = 'logic-gatt-desktop-app';
const MOBILE = 'logic-gatt-mobile-app';

/** The desktop package.json version is the single source of truth for both apps. */
export function currentVersion(): string {
  return JSON.parse(readFileSync(join(root, DESKTOP, 'package.json'), 'utf8')).version;
}

/**
 * RELEASE_DIR lets a second checkout — a Linux one under WSL, say — stage into the first
 * one's release folder, so assets built on different hosts land together.
 */
export const releaseDir = (version: string) => join(process.env.RELEASE_DIR || join(root, 'release'), `v${version}`);

/** Electrobun's os-arch spelling, as it appears in its artifact filenames. */
export const hostPlatform = (() => {
  const os = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'macos' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  return `${os}-${arch}`;
})();

/** Platforms a complete release carries. Anything else staged is a bonus, not a gap. */
export const expectedPlatforms = ['win-x64', 'linux-x64', 'android'];

export const buildCommand: Record<string, string> = {
  'win-x64': 'make release-desktop   (on Windows)',
  'linux-x64': 'make release-desktop   (on Linux / WSL)',
  android: 'make release-android',
};

export const CHECKSUMS = 'SHA256SUMS';

/** Staged asset name for a platform. Desktop keeps its source extension (.zip / .tar.gz). */
export function assetName(platform: string, version: string, ext = ''): string {
  return platform === 'android'
    ? `LogicGATT-${version}.apk`
    : `LogicGATT-Setup-${version}-${platform}${ext}`;
}

/** `.tar.gz` is two extensions, so extname() alone gets it wrong. */
export const extensionOf = (file: string) => (file.endsWith('.tar.gz') ? '.tar.gz' : file.slice(file.lastIndexOf('.')));

/**
 * The installer electrobun just built for THIS host. Matched by pattern rather than a
 * fixed name: Windows produces a `-Setup.zip`, Linux a `-Setup.tar.gz`, and the channel
 * suffix moves around. The sibling `.tar.zst` and `update.json` are auto-update payloads,
 * not downloads, so they are deliberately excluded.
 */
export function findDesktopArtifact(channel = 'stable'): string | null {
  const dir = join(root, DESKTOP, 'artifacts');
  if (!existsSync(dir)) return null;
  const prefix = `${channel}-${hostPlatform}-`;
  const hit = readdirSync(dir).find(
    (f) => f.startsWith(prefix) && f.includes('Setup') && (f.endsWith('.zip') || f.endsWith('.tar.gz'))
  );
  return hit ? join(dir, hit) : null;
}

export const apkArtifact = join(root, MOBILE, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Which platforms are staged for a version, in the order a release lists them. */
export function stagedAssets(version: string): { platform: string; file: string | null; size: number }[] {
  const dir = releaseDir(version);
  const present = existsSync(dir) ? readdirSync(dir) : [];
  return expectedPlatforms.map((platform) => {
    const file =
      present.find((f) =>
        platform === 'android' ? f === assetName(platform, version) : f.startsWith(assetName(platform, version, '.'))
      ) ?? null;
    return { platform, file, size: file ? statSync(join(dir, file)).size : 0 };
  });
}

/** Rendered status block, shared by `release-status` and the tail of each staging run. */
export function statusLines(version: string): string[] {
  const assets = stagedAssets(version);
  const dir = releaseDir(version);
  const shown = dir.startsWith(root) ? dir.slice(root.length + 1).replace(/\\/g, '/') : dir;
  const lines = [``, `  LogicGATT v${version}   ->   ${shown}/`, ``];
  for (const { platform, file, size } of assets) {
    lines.push(
      file
        ? `    [x] ${platform.padEnd(10)} ${file}  (${mb(size)})`
        : `    [ ] ${platform.padEnd(10)} missing  ->  ${buildCommand[platform]}`
    );
  }
  const missing = assets.filter((a) => !a.file);
  lines.push(``);
  lines.push(
    missing.length === 0
      ? `  Complete. Publish with:  make release-publish`
      : `  ${missing.length} of ${assets.length} platform(s) still to build.`
  );
  lines.push(``);
  return lines;
}
