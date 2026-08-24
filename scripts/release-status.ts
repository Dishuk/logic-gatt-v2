#!/usr/bin/env bun
/**
 * Report the current version and which platforms are staged for it.
 *
 *   bun scripts/release-status.ts
 *
 * Read-only: it builds nothing and stages nothing, so it is safe to run at any point
 * between hosts to see what a release is still waiting on.
 */
import { currentVersion, statusLines } from './release-assets.ts';

console.log(statusLines(currentVersion()).join('\n'));
