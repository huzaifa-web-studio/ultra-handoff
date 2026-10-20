/**
 * Organization state that outlives a single session.
 *
 * Why: Better Auth creates every session with `activeOrganizationId` unset, so
 * a returning user would land on the create-organization screen even though
 * they already belong to a workspace. The sign-in session hook in
 * src/auth/auth.ts calls this module to restore the organization the user was
 * last working in, inside the same sign-in request.
 *
 * These are Better Auth owned tables (`user`, `member`), which stay on the
 * privileged client by design. See src/services/account.service.ts for the
 * same pattern.
 *
 * Used by: src/auth/auth.ts (session database hooks only).
 */

import { and, asc, eq, isNull, ne, or } from "drizzle-orm";

import { adminDb } from "../db";
import { member, user } from "../db/auth-schema";

/**
 * Pick the organization a new session should start in.
 *
 * Order of preference:
 *   1. The last organization this user activated, if they are still a member.
 *   2. Their earliest surviving membership, which covers invited users and a
 *      pointer that was cleared by an organization deletion.
 *   3. null, so a user with no memberships keeps the create-organization flow.
 */
export async function resolveSignInOrganization(
	userId: string,
): Promise<string | null> {
	const [record] = await adminDb
		.select({ lastActiveOrganizationId: user.lastActiveOrganizationId })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);

	const lastActiveOrganizationId = record?.lastActiveOrganizationId;

	// A membership check is required, not just the pointer. The user may have
	// been removed from the organization or left it since the last sign-in.
	if (lastActiveOrganizationId) {
		const [membership] = await adminDb
			.select({ organizationId: member.organizationId })
			.from(member)
			.where(
				and(
					eq(member.userId, userId),
					eq(member.organizationId, lastActiveOrganizationId),
				),
			)
			.limit(1);

		if (membership) {
			return membership.organizationId;
		}
	}

	const [fallback] = await adminDb
		.select({ organizationId: member.organizationId })
		.from(member)
		.where(eq(member.userId, userId))
		.orderBy(asc(member.createdAt))
		.limit(1);

	return fallback?.organizationId ?? null;
}

/**
 * Store the organization the user just made active.
 *
 * Called from the session update hook, so it runs for `setActive`, for
 * `acceptInvitation` and for any other path that changes the active
 * organization.
 *
 * Null is ignored on purpose: an explicit unset, or a rejected `setActive` for
 * an organization the caller does not belong to, must not erase the memory.
 */
export async function rememberActiveOrganization(
	userId: string,
	organizationId: string | null,
): Promise<void> {
	if (!organizationId) {
		return;
	}

	// The condition keeps routine session refreshes from rewriting the same
	// value, which would bump `user.updatedAt` for no reason.
	await adminDb
		.update(user)
		.set({ lastActiveOrganizationId: organizationId })
		.where(
			and(
				eq(user.id, userId),
				or(
					isNull(user.lastActiveOrganizationId),
					ne(user.lastActiveOrganizationId, organizationId),
				),
			),
		);
}
