/**
 * Invitation lookup for the magic-link gate.
 *
 * Why a separate module: the gate in `src/auth/auth.ts` needs one read against
 * the Better Auth `invitation` table. Importing it from
 * `services/invitation.service.ts` would create a cycle, because that service
 * imports the `auth` instance. The table belongs to Better Auth, so the read
 * goes through the privileged `adminDb`, read only, which is the same rule the
 * other auth-table lookups follow.
 *
 * Used by: src/auth/auth.ts.
 */

import { and, eq, gt } from "drizzle-orm";

import { adminDb } from "../db";
import { invitation } from "../db/auth-schema";

/**
 * True when a pending, unexpired invitation exists for the address.
 *
 * `status = 'pending'` alone is not enough: a forgotten row keeps its status
 * after the deadline, so the expiry check is what a person experiences.
 */
export async function hasPendingInvitationForEmail(
	email: string,
): Promise<boolean> {
	const [row] = await adminDb
		.select({ id: invitation.id })
		.from(invitation)
		.where(
			and(
				eq(invitation.email, email),
				eq(invitation.status, "pending"),
				gt(invitation.expiresAt, new Date()),
			),
		)
		.limit(1);

	return Boolean(row);
}
