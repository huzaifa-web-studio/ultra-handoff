/**
 * Channel input validation.
 *
 * Why pure helpers: create, rename and member management all need the same
 * rules, and unit tests should not need a database. The async membership check
 * lives here too so every caller rejects a bad input before it opens a
 * transaction.
 *
 * Used by: every module in `services/conversation/channels/`.
 */

import { APIError } from "better-auth/api";

import { getOrganizationMembers } from "../../organization.service";
import {
	CHANNEL_DESCRIPTION_MAX,
	CHANNEL_MEMBER_MAX,
	CHANNEL_TITLE_MAX,
	CHANNEL_TITLE_MIN,
	type ChannelVisibility,
} from "../types";

/** Remove control characters and collapse runs of whitespace. */
function collapse(value: string): string {
	return (
		value
			// biome-ignore lint/suspicious/noControlCharactersInRegex: a channel name must not carry a control character into a bell sentence or an href
			.replace(/[\u0000-\u001f\u007f]/g, " ")
			.replace(/\s+/g, " ")
			.trim()
	);
}

/**
 * Normalise a channel name.
 *
 * A leading `#` is stripped because the UI always renders one, and nobody wants
 * a channel whose real name starts with two hashes. Control characters are
 * removed so a name cannot break a bell sentence or an href.
 */
export function normalizeChannelTitle(value: string): string {
	const title = collapse(value)
		.replace(/^#+\s*/, "")
		.trim();

	if (title.length < CHANNEL_TITLE_MIN) {
		throw new APIError("BAD_REQUEST", {
			message: "Give the channel a name.",
		});
	}

	if (title.length > CHANNEL_TITLE_MAX) {
		throw new APIError("BAD_REQUEST", {
			message: `Channel names can be at most ${CHANNEL_TITLE_MAX} characters.`,
		});
	}

	return title;
}

/** Normalise an optional channel topic. Null and blank become null. */
export function normalizeChannelDescription(
	value: string | null | undefined,
): string | null {
	if (value === null || value === undefined) return null;

	const description = collapse(value);

	if (description.length === 0) return null;

	if (description.length > CHANNEL_DESCRIPTION_MAX) {
		throw new APIError("BAD_REQUEST", {
			message: `Channel topics can be at most ${CHANNEL_DESCRIPTION_MAX} characters.`,
		});
	}

	return description;
}

/** Read a visibility value without trusting the stored string. */
export function normalizeVisibility(value: string): ChannelVisibility {
	if (value === "public" || value === "private") return value;

	throw new APIError("BAD_REQUEST", {
		message: "Choose whether the channel is public or private.",
	});
}

/**
 * Clean a member id list.
 *
 * Removes blanks, duplicates and the creator, because the creator is always an
 * owner and must not appear twice. The cap counts the creator, so one less
 * other person is accepted.
 */
export function normalizeMemberIds(
	values: string[] | undefined,
	creatorId: string,
): string[] {
	const ids = new Set<string>();

	for (const value of values ?? []) {
		const id = value.trim();

		if (id.length === 0 || id === creatorId) continue;

		ids.add(id);
	}

	if (ids.size > CHANNEL_MEMBER_MAX - 1) {
		throw new APIError("BAD_REQUEST", {
			message: `A channel can have at most ${CHANNEL_MEMBER_MAX} members.`,
		});
	}

	return [...ids];
}

/**
 * Reject ids that are not current members of the workspace.
 *
 * Why on the privileged client: membership lives in the Better Auth tables and
 * a channel must not hold a participant who can never open it. Runs before the
 * transaction so a slow lookup does not hold one open.
 */
export async function assertWorkspaceMembers(
	organizationId: string,
	userIds: string[],
): Promise<void> {
	if (userIds.length === 0) return;

	const members = await getOrganizationMembers(organizationId, userIds);

	if (members.size !== userIds.length) {
		throw new APIError("BAD_REQUEST", {
			message: "One of those people is no longer part of this workspace.",
		});
	}
}

/**
 * True for a Postgres unique violation.
 *
 * The channel name index is the concurrency guard, so a duplicate create that
 * raced the service check has to become a friendly 409 rather than a 500.
 */
export function isUniqueViolation(
	error: unknown,
	constraint?: string,
): boolean {
	if (!error || typeof error !== "object") return false;

	const record = error as {
		code?: unknown;
		constraint?: unknown;
		constraint_name?: unknown;
		cause?: unknown;
	};

	if (record.code === "23505") {
		if (!constraint) return true;

		return (
			record.constraint === constraint || record.constraint_name === constraint
		);
	}

	// Drizzle can wrap a driver error. One step down finds the Postgres cause
	// without walking an unbounded chain.
	return isUniqueViolation(record.cause, constraint);
}
