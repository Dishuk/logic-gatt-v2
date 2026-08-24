/**
 * The one place hex byte strings are read and written.
 *
 * Both halves of the app deal in the same textual form — uppercase, space-separated
 * byte pairs (`"AB CD"`) — for characteristic defaults, manufacturer data, variables,
 * test vectors and log dumps. This module is what every one of those paths goes
 * through, so a value means the same thing wherever it is used.
 *
 * It lives in `shared/` because the Bun main process needs it too: the value the
 * ble-uart plugin uploads to a dongle has to be the bytes the webview's runtime would
 * have served. Kept dependency-free so it loads on either side.
 *
 * ## The rule for a lopsided string
 *
 * Hex digits are read in pairs, and a trailing half-byte is **ignored** — `"AB C"` is
 * one byte, not two. Parsing runs on every keystroke in the editing fields, so a
 * half-typed byte must not briefly read as a whole one. `normalizeHex` is the other
 * half of that bargain: fields commit through it, and it pads a lopsided digit into a
 * whole byte (`"ABC"` -> `"AB 0C"`), so nothing a person types is silently dropped and
 * a stored value never contains a partial byte to disagree about.
 */

/** Read a hex string into bytes. Non-hex characters are separators; see the note above. */
export function parseHex(raw: string): Uint8Array {
	const clean = raw.replace(/[^0-9a-fA-F]/g, "");
	const out: number[] = [];
	for (let i = 0; i + 2 <= clean.length; i += 2) out.push(parseInt(clean.slice(i, i + 2), 16));
	return new Uint8Array(out);
}

/** Render bytes as uppercase space-separated pairs — the form every field stores. */
export function formatHex(bytes: Uint8Array): string {
	return Array.from(bytes)
		.map((b) => b.toString(16).toUpperCase().padStart(2, "0"))
		.join(" ");
}

/**
 * Canonical form of whatever was typed, for committing an edited field.
 *
 * An odd digit count is padded rather than truncated: the last digit is the low half
 * of its byte, so `"ABC"` commits as `"AB 0C"`.
 */
export function normalizeHex(raw: string): string {
	const clean = raw.replace(/[^0-9a-fA-F]/g, "");
	const even = clean.length % 2 === 0 ? clean : `${clean.slice(0, -1)}0${clean.slice(-1)}`;
	return formatHex(parseHex(even));
}

/** Whether two hex strings denote the same bytes, whatever their spacing or case. */
export function hexEquals(a: string, b: string): boolean {
	return formatHex(parseHex(a)) === formatHex(parseHex(b));
}
