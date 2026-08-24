#!/usr/bin/env bun
/**
 * Interactive version bump across both apps, in lockstep.
 *
 *   make version                       prompt for the new version
 *   bun scripts/version.ts <spec> -y   non-interactive (patch | minor | major | X.Y.Z)
 *
 * Writes only version fields:
 *   logic-gatt-desktop-app/package.json          version
 *   logic-gatt-desktop-app/electrobun.config.ts  app.version
 *   logic-gatt-mobile-app/app.json               expo.version, ios.buildNumber, android.versionCode
 *
 * Android's native project is regenerated from app.json (Expo CNG), so build.gradle is
 * never touched. Building, staging and git are separate steps — none of them happen here.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { currentVersion, root } from './release-assets.ts';

const desktopPkgPath = join(root, 'logic-gatt-desktop-app', 'package.json');
const electrobunCfgPath = join(root, 'logic-gatt-desktop-app', 'electrobun.config.ts');
const appJsonPath = join(root, 'logic-gatt-mobile-app', 'app.json');

type Semver = [number, number, number];

function parse(version: string): Semver {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!m) throw new Error(`Not a valid semver (X.Y.Z): "${version}"`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

const compare = (a: Semver, b: Semver) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** Preserve each JSON file's own indentation, so a bump touches only the version lines. */
const detectIndent = (json: string) => /\n([ \t]+)"/.exec(json)?.[1] ?? '  ';

/**
 * Derived rather than incremented, so a repeated run or a reverted app.json cannot drift
 * it out of step with the version users see. Android only requires it to increase.
 */
function versionCode([maj, min, pat]: Semver): number {
  if (min > 99 || pat > 99) throw new Error(`minor and patch must stay below 100 to encode a versionCode`);
  return maj * 10000 + min * 100 + pat;
}

const bump = {
  patch: ([maj, min, pat]: Semver) => `${maj}.${min}.${pat + 1}`,
  minor: ([maj, min]: Semver) => `${maj}.${min + 1}.0`,
  major: ([maj]: Semver) => `${maj + 1}.0.0`,
};

const current = currentVersion();
const currentParsed = parse(current);
const suggestions = {
  patch: bump.patch(currentParsed),
  minor: bump.minor(currentParsed),
  major: bump.major(currentParsed),
};

/** A spec is a bump keyword or a literal version. */
function resolve(spec: string): string {
  const key = spec.trim().toLowerCase();
  return key in suggestions ? suggestions[key as keyof typeof suggestions] : spec.trim();
}

const args = process.argv.slice(2);
const assumeYes = args.includes('-y') || args.includes('--yes');
const spec = args.find((a) => !a.startsWith('-'));

let next: string;
if (spec) {
  next = resolve(spec);
} else {
  if (!process.stdin.isTTY) {
    console.error('No terminal to prompt on. Pass a version: bun scripts/version.ts <patch|minor|major|X.Y.Z> -y');
    process.exit(1);
  }
  console.log(``);
  console.log(`  LogicGATT   current version  ${current}`);
  console.log(``);
  console.log(`    patch    ${suggestions.patch}`);
  console.log(`    minor    ${suggestions.minor}`);
  console.log(`    major    ${suggestions.major}`);
  console.log(`    custom   X.Y.Z`);
  console.log(``);
  const answer = prompt('  New version', suggestions.patch);
  if (answer === null) process.exit(1);
  next = resolve(answer);
}

const nextParsed = parse(next);
if (compare(nextParsed, currentParsed) <= 0) {
  console.error(`Refusing to go from ${current} to ${next} — the new version must be higher.`);
  process.exit(1);
}

const appJson = readFileSync(appJsonPath, 'utf8');
const app = JSON.parse(appJson);
const nextCode = versionCode(nextParsed);

console.log(``);
console.log(`  logic-gatt-desktop-app/package.json          version              ${current} -> ${next}`);
console.log(`  logic-gatt-desktop-app/electrobun.config.ts  app.version          ${current} -> ${next}`);
console.log(`  logic-gatt-mobile-app/app.json               version              ${current} -> ${next}`);
console.log(`                                               ios.buildNumber      ${current} -> ${next}`);
console.log(
  `                                               android.versionCode  ${app.expo.android?.versionCode ?? '-'} -> ${nextCode}`
);
console.log(``);

if (!assumeYes && !confirm('  Apply?')) {
  console.log('  Nothing written.');
  process.exit(0);
}

// 1. desktop package.json
const desktopJson = readFileSync(desktopPkgPath, 'utf8');
const desktopPkg = JSON.parse(desktopJson);
desktopPkg.version = next;
writeFileSync(desktopPkgPath, JSON.stringify(desktopPkg, null, detectIndent(desktopJson)) + '\n');

// 2. electrobun.config.ts — the first `version: '...'` is app.version
const cfg = readFileSync(electrobunCfgPath, 'utf8');
if (!/version:\s*'[^']*'/.test(cfg)) throw new Error('Could not find app.version in electrobun.config.ts');
writeFileSync(electrobunCfgPath, cfg.replace(/version:\s*'[^']*'/, `version: '${next}'`));

// 3. mobile app.json
app.expo.version = next;
app.expo.ios = app.expo.ios ?? {};
app.expo.ios.buildNumber = next;
app.expo.android = app.expo.android ?? {};
app.expo.android.versionCode = nextCode;
writeFileSync(appJsonPath, JSON.stringify(app, null, detectIndent(appJson)) + '\n');

console.log(``);
console.log(`  Version is now ${next}. Review the diff, then commit and tag:`);
console.log(``);
console.log(`    git commit -am "Release v${next}"`);
console.log(`    git tag v${next}`);
console.log(``);
console.log(`  Then build:  make release-desktop   (once per OS)`);
console.log(`               make release-android`);
console.log(``);
