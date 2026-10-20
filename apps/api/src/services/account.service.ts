/**
 * Account deletion policy.
 *
 * Why: deleting a user cascades their member rows. If they are the only owner
 * of an organization, the organization would be left without an owner. The UI
 * needs to know this before it asks Better Auth to send a confirmation email,
 * and the deletion hooks need the same answer as a final safeguard.
 *
 * Used by: src/auth/auth.ts and src/routes/account.ts.
 */

import { and, eq, ne } from "drizzle-orm";

import { adminDb } from "../db";
import { member } from "../db/auth-schema";

/**
 * Return the reason this user cannot delete their account, or null when the
 * deletion is allowed.
 *
 * The message is user facing because both the account card and the Better Auth
 * error response show it directly.
 */
export async function getAccountDeletionBlocker(
	userId: string,
): Promise<string | null> {
	// Organizations where this user has the owner role.
	const ownedOrganizations = await adminDb
		.select({ organizationId: member.organizationId })
		.from(member)
		.where(and(eq(member.userId, userId), eq(member.role, "owner")));

	for (const owned of ownedOrganizations) {
		// The exact condition we care about: is there any other owner in this
		// organization? A row here means the user is not alone, so the
		// organization keeps an owner after this account is deleted.
		const otherOwners = await adminDb
			.select({ id: member.id })
			.from(member)
			.where(
				and(
					eq(member.organizationId, owned.organizationId),
					eq(member.role, "owner"),
					ne(member.userId, userId),
				),
			)
			.limit(1);

		if (otherOwners.length === 0) {
			return "Transfer ownership of your organization before deleting your account.";
		}
	}

	return null;
}
