#!/usr/bin/env bun
/**
 * Copy one freshly built artifact into release/v<version>/.
 *
 *   bun scripts/stage-release.ts desktop|android
 *
 * Additive by design: a run replaces only its own asset, so a Windows host, a Linux host
 * and an Android build can fill the same folder independently and in any order — the
 * folder is never cleared. The version is read from the manifests, never passed in, so a
 * stale build lands under its own version and cannot masquerade as the current one.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import {
  CHECKSUMS,
  assetName,
  apkArtifact,
  currentVersion,
  extensionOf,
  findDesktopArtifact,
  hostPlatform,
  releaseDir,
  statusLines,
} from './release-assets.ts';

const kind = (process.argv[2] ?? '').trim();
if (kind !== 'desktop' && kind !== 'android') {
  console.error('Usage: bun scripts/stage-release.ts desktop|android');
  process.exit(1);
}

const version = currentVersion();
const dir = releaseDir(version);

const source = kind === 'desktop' ? findDesktopArtifact('stable') : existsSync(apkArtifact) ? apkArtifact : null;

if (!source) {
  const how = kind === 'desktop' ? 'make release-desktop' : 'make release-android';
  console.error(`No ${kind} artifact to stage. Build it first: ${how}`);
  process.exit(1);
}

const platform = kind === 'desktop' ? hostPlatform : 'android';
const target = join(dir, assetName(platform, version, extensionOf(source)));

mkdirSync(dir, { recursive: true });
copyFileSync(source, target);
console.log(`  staged  ${basename(target)}`);

// Rewritten from whatever the folder now holds, so each host's line survives the others.
const files = readdirSync(dir)
  .filter((f) => f !== CHECKSUMS)
  .sort();
const sums: string[] = [];
for (const f of files) {
  const bytes = await Bun.file(join(dir, f)).arrayBuffer();
  sums.push(`${new Bun.CryptoHasher('sha256').update(bytes).digest('hex')}  ${f}`);
}
writeFileSync(join(dir, CHECKSUMS), sums.join('\n') + '\n');

console.log(statusLines(version).join('\n'));
