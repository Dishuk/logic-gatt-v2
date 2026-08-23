/**
 * Filesystem layer for project files.
 *
 * The webview cannot touch the filesystem — a Blob download is the only write it has —
 * so every open/save goes through here over RPC.
 *
 * Electrobun 1.18.1 exposes `openFileDialog` and nothing else: there is no save dialog,
 * so Save As is a directory pick plus a filename entered in-app, resolved by
 * `resolveProjectPath`. `openFileDialog` returns its result comma-joined and yields a
 * single empty string when the dialog is cancelled, hence `firstPath`.
 */

import { Utils } from "electrobun/bun";
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import type { ProjectFile } from "../shared/rpc";

/** Characters Windows rejects in a file name; flagged here for a clearer error than EINVAL. */
const INVALID_NAME_CHARS = /["*:<>?|]/;

function firstPath(paths: string[]): string | null {
	const picked = paths.find((p) => p.trim().length > 0);
	return picked ? picked.trim() : null;
}

/** Show the open dialog and read the chosen file. `null` when cancelled. */
export async function openProjectFile(): Promise<ProjectFile | null> {
	const picked = await Utils.openFileDialog({
		allowedFileTypes: "json",
		canChooseFiles: true,
		canChooseDirectory: false,
		allowsMultipleSelection: false,
	});
	const path = firstPath(picked);
	if (!path) return null;
	return { path, contents: readFileSync(path, "utf8") };
}

/** Show the directory picker used by Save As. `null` when cancelled. */
export async function pickProjectDirectory(): Promise<string | null> {
	const picked = await Utils.openFileDialog({
		canChooseFiles: false,
		canChooseDirectory: true,
		allowsMultipleSelection: false,
	});
	return firstPath(picked);
}

/**
 * Turn a picked directory + a typed name into an absolute path, appending `.json` and
 * refusing anything that would land outside the directory.
 */
export function resolveProjectPath(dir: string, name: string): { path: string; exists: boolean } {
	const clean = name.trim();
	if (!clean) throw new Error("A file name is required.");
	if (/[\\/]/.test(clean)) throw new Error("A file name cannot contain a path.");
	if (INVALID_NAME_CHARS.test(clean)) throw new Error('A file name cannot contain " * : < > ? |');

	const withExt = extname(clean).toLowerCase() === ".json" ? clean : `${clean}.json`;
	const path = resolve(dir, withExt);
	// Catches a bare ".." — it has no separator, so the check above lets it through.
	if (dirname(path) !== resolve(dir)) throw new Error("A file name cannot leave the chosen folder.");

	return { path, exists: existsSync(path) };
}

/**
 * Overwrite `path` atomically: write a sibling temp file, then rename over the target
 * (same directory, so it is a single filesystem operation on both NTFS and POSIX).
 * A truncating write that failed midway would destroy the project instead.
 */
export function writeProjectFile(path: string, contents: string): void {
	const tmp = `${path}.tmp-${process.pid}`;
	try {
		writeFileSync(tmp, contents, "utf8");
		renameSync(tmp, path);
	} catch (err) {
		try {
			if (existsSync(tmp)) unlinkSync(tmp);
		} catch {
			/* best effort — the write already failed */
		}
		throw err;
	}
}
