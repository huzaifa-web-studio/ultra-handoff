/**
 * Organization state that outlives a single session.
 *
 * Why: Better Auth creates every session with `activeOrganizationId` unset, so
 * a returning user would land on the create-organization screen even though
 * they already belong to a workspace. The sign-in session hook in
 * src/auth/auth.ts calls this module to restore the organization the user was
 * last working in, inside the same sign-in request.
 *
 * These are Better Auth owned tables (`user`, `member`, `organization`), which
 * stay on the privileged client by design. See src/services/account.service.ts
 * for the same pattern. The membership lookups are only used after a session
 * or tenant check has already identified the caller, never to grant access on
 * their own.
 *
 * Used by: src/auth/auth.ts (session database hooks), src/routes/uploads.ts and
 * src/routes/organization.ts.
 */

import { and, asc, eq, isNull, ne, or } from "drizzle-orm";

import { adminDb } from "../db";
import { member, organization, user } from "../db/auth-schema";

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
 * Read the caller's role in one organization.
 *
 * Why here: the generic upload endpoints are not under `:orgSlug`, so the
 * tenant macro cannot resolve them. This is the same membership check in a
 * smaller form. Returns null when the user is not a member, which callers must
 * treat as "not found", never as "no role, allow".
 */
export async function getOrganizationRole(
	userId: string,
	organizationId: string,
): Promise<string | null> {
	const [record] = await adminDb
		.select({ role: member.role })
		.from(member)
		.where(
			and(eq(member.userId, userId), eq(member.organizationId, organizationId)),
		)
		.limit(1);

	return record?.role ?? null;
}

/**
 * Read an organization's current logo URL.
 *
 * Needed before a logo update so the replaced object can be deleted after the
 * new URL is stored. Better Auth returns the updated row, not the old value.
 */
export async function getOrganizationLogo(
	organizationId: string,
): Promise<string | null> {
	const [record] = await adminDb
		.select({ logo: organization.logo })
		.from(organization)
		.where(eq(organization.id, organizationId))
		.limit(1);

	return record?.logo ?? null;
}

/** Read the slug for an organization id, or null when it no longer exists. */
export async function getOrganizationSlug(
	organizationId: string,
): Promise<string | null> {
	const [record] = await adminDb
		.select({ slug: organization.slug })
		.from(organization)
		.where(eq(organization.id, organizationId))
		.limit(1);

	return record?.slug ?? null;
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
