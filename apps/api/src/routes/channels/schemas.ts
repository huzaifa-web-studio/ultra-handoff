/**
 * Channel route schemas.
 *
 * Why separate: the create, settings and membership routes share the same
 * parameter and body shapes. Keeping them here means a limit change is made
 * once.
 *
 * Used by: the route files in `routes/channels/`.
 */

import { t } from "elysia";

import {
	CHANNEL_DESCRIPTION_MAX,
	CHANNEL_MEMBER_MAX,
	CHANNEL_TITLE_MAX,
} from "../../services/conversation";

/** One conversation in the URL. */
export const channelParams = t.Object({
	orgSlug: t.String({ minLength: 1, maxLength: 255 }),
	conversationId: t.String({ minLength: 1, maxLength: 64 }),
});

/** One member in the URL. */
export const memberParams = t.Object({
	orgSlug: t.String({ minLength: 1, maxLength: 255 }),
	conversationId: t.String({ minLength: 1, maxLength: 64 }),
	userId: t.String({ minLength: 1, maxLength: 64 }),
});

/** Browse query. */
export const browseQuery = t.Object({
	search: t.Optional(t.String({ maxLength: 100 })),
	limit: t.Optional(t.String()),
});

/** Create body. */
export const createChannelBody = t.Object({
	title: t.String({ minLength: 1, maxLength: CHANNEL_TITLE_MAX }),
	description: t.Optional(
		t.Union([t.String({ maxLength: CHANNEL_DESCRIPTION_MAX }), t.Null()]),
	),
	visibility: t.UnionEnum(["public", "private"]),
	memberIds: t.Optional(
		t.Array(t.String({ minLength: 1, maxLength: 64 }), {
			maxItems: CHANNEL_MEMBER_MAX - 1,
		}),
	),
});

/** Settings body. Every field is optional, but at least one must be sent. */
export const updateChannelBody = t.Object({
	title: t.Optional(t.String({ minLength: 1, maxLength: CHANNEL_TITLE_MAX })),
	description: t.Optional(
		t.Union([t.String({ maxLength: CHANNEL_DESCRIPTION_MAX }), t.Null()]),
	),
	visibility: t.Optional(t.UnionEnum(["public", "private"])),
});

/** Add members body. */
export const addMembersBody = t.Object({
	userIds: t.Array(t.String({ minLength: 1, maxLength: 64 }), {
		minItems: 1,
		maxItems: CHANNEL_MEMBER_MAX - 1,
	}),
});

/** Change one member's role. */
export const updateMemberBody = t.Object({
	role: t.UnionEnum(["owner", "member"]),
});
