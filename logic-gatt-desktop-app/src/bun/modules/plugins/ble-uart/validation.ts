/**
 * BLE UART plugin validation utilities.
 *
 * Ported from the old plugin; uses `zod` directly instead of the old shared package's
 * re-export, and carries its own `ValidationResult` shape.
 */

import { z } from "zod";

export interface ValidationResult {
	valid: boolean;
	errors: string[];
}

/**
 * Serial port path schema.
 * Validates Windows COM ports and Unix /dev/tty* paths.
 */
export const SerialPortPathSchema = z
	.string()
	.min(1, "Path cannot be empty")
	.refine((path) => !path.includes(".."), 'Path cannot contain ".."')
	.refine((path) => {
		const windowsPattern = /^COM\d+$/i;
		const unixPattern = /^\/dev\/(tty[A-Za-z]+\d*|cu\.[a-zA-Z0-9_-]+)$/;
		return windowsPattern.test(path) || unixPattern.test(path);
	}, "Invalid serial port path format. Expected COM* (Windows) or /dev/tty* (Unix)");

/** Validate a serial port path. */
export function validateSerialPortPath(path: string): ValidationResult {
	const result = SerialPortPathSchema.safeParse(path);
	if (result.success) return { valid: true, errors: [] };
	return { valid: false, errors: result.error.issues.map((i) => i.message) };
}
