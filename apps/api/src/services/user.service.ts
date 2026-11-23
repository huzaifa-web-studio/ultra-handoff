/**
 * Small read helpers for Better Auth user rows.
 *
 * Why a module of its own: several features need a display name or a timezone
 * for a set of user ids, and the lookup is always a privileged read because
 * `user` belongs to Better Auth. Keeping it here avoids a circular import
 * between the project service and the notification writer, both of which need
 * the same lookup.
 *
 * Read only. Nothing in this file grants access to workspace data.
 *
 * Used by: services/project.service.ts (re-exported for existing callers),
 * services/notification.service.ts and services/reminder.service.ts.
 */

import { inArray } from "drizzle-orm";

import { adminDb } from "../db";
import { user } from "../db/auth-schema";

/** One person as the app displays them. */
export type UserName = {
	name: string;
	email: string;
	image: string | null;
};

/**
 * Read names and avatars for a set of user ids.
 *
 * One query for the whole set, so a page of notifications never becomes an
 * N+1 read. A missing id simply produces no entry, which callers render as a
 * former member.
 */
export async function loadUserMap(
	userIds: string[],
): Promise<Map<string, UserName>> {
	if (userIds.length === 0) return new Map();

	const rows = await adminDb
		.select({
			id: user.id,
			name: user.name,
			email: user.email,
			image: user.image,
		})
		.from(user)
		.where(inArray(user.id, userIds));

	return new Map(
		rows.map((row) => [
			row.id,
			{ name: row.name, email: row.email, image: row.image },
		]),
	);
}

/**
 * Read the reported IANA timezone for a set of user ids.
 *
 * Null is meaningful: the person has never opened the app since the timezone
 * feature shipped, so the reminder sweep falls back to UTC.
 */
export async function loadUserTimezones(
	userIds: string[],
): Promise<Map<string, string | null>> {
	if (userIds.length === 0) return new Map();

	const rows = await adminDb
		.select({ id: user.id, timezone: user.timezone })
		.from(user)
		.where(inArray(user.id, userIds));

	return new Map(rows.map((row) => [row.id, row.timezone]));
}
