/**
 * Opaque notification cursor encoding.
 *
 * Why this file: the list and the summary share one cursor format, and it must
 * reject malformed input the same way on both. Keeping encode and decode
 * together makes that contract explicit.
 *
 * Used by: `list.ts`.
 */

/** Six fractional digits at most, matching the column. */

import type { NotificationCursor } from "./types";

const CURSOR_TIMESTAMP_PATTERN =
	/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/;

/** Notifications use UUID primary keys. */
const CURSOR_ID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Decode a notification cursor, rejecting anything we did not produce.
 *
 * `Buffer.from(value, "base64url")` never throws for a string, so validation
 * has to happen after decoding. The cursor is not a security boundary, because
 * every query is still scoped to the recipient and the organization; a forged
 * valid cursor only changes where the person starts reading their own list.
 */
export function decodeNotificationCursor(
	cursor: string,
): NotificationCursor | null {
	let decoded: string;

	try {
		decoded = Buffer.from(cursor, "base64url").toString("utf8");
	} catch {
		return null;
	}

	if (decoded.length === 0 || decoded.length > 256) return null;

	let parsed: unknown;

	try {
		parsed = JSON.parse(decoded);
	} catch {
		return null;
	}

	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return null;
	}

	const record = parsed as Record<string, unknown>;

	if (
		typeof record.t !== "string" ||
		!CURSOR_TIMESTAMP_PATTERN.test(record.t)
	) {
		return null;
	}

	if (typeof record.i !== "string" || !CURSOR_ID_PATTERN.test(record.i)) {
		return null;
	}

	return { createdAt: record.t, id: record.i };
}

/** Encode one position as the next page cursor. */
export function encodeNotificationCursor(
	createdAt: string,
	id: string,
): string {
	return Buffer.from(JSON.stringify({ t: createdAt, i: id }), "utf8").toString(
		"base64url",
	);
}
