/**
 * Public invitation preview.
 *
 * Why this file: the accept page has no session, so the preview uses narrow
 * read only lookups by id and masks the email. Keeping it apart from the
 * manager surface makes that lower trust explicit.
 *
 * Used by: `routes/invitations.ts`.
 */

import { eq } from "drizzle-orm";
import { auth } from "../../auth/auth";
import { adminDb } from "../../db";
import { invitation, organization, user } from "../../db/auth-schema";
import { deriveStatus, maskEmail } from "./helpers";
import type { InvitationPreview } from "./types";

/**
 * Public preview for the accept page.
 *
 * Why not Better Auth's `getInvitation`: it requires a signed in session whose
 * email matches, and the page has to explain the invitation before the visitor
 * signs in. This reads one invitation and two labels by id, exposes no email
 * beyond a mask, and never mutates anything. The invite link is the bearer
 * token, so possessing it is the intended access.
 */
export async function previewInvitation(
	invitationId: string,
	headers: Headers,
): Promise<InvitationPreview | null> {
	const [row] = await adminDb
		.select()
		.from(invitation)
		.where(eq(invitation.id, invitationId))
		.limit(1);

	if (!row) return null;

	const [workspace] = await adminDb
		.select({
			id: organization.id,
			name: organization.name,
			slug: organization.slug,
		})
		.from(organization)
		.where(eq(organization.id, row.organizationId))
		.limit(1);

	if (!workspace) return null;

	const [inviter] = await adminDb
		.select({ name: user.name, email: user.email })
		.from(user)
		.where(eq(user.id, row.inviterId))
		.limit(1);

	const status = deriveStatus(row);

	// The browser session decides the next step, but never reveals the target
	// address. An anonymous visitor gets null rather than false so the page can
	// distinguish "not signed in" from "signed in as someone else".
	const session = await auth.api.getSession({ headers });
	const emailMatches = session
		? session.user.email.toLowerCase() === row.email.toLowerCase()
		: null;

	return {
		invitationId: row.id,
		organizationId: workspace.id,
		organizationName: workspace.name,
		organizationSlug: workspace.slug,
		inviterName: inviter?.name || inviter?.email || "A teammate",
		role: row.role ?? "member",
		status,
		maskedEmail: maskEmail(row.email),
		expiresAt: new Date(row.expiresAt).toISOString(),
		viewer: {
			signedIn: Boolean(session),
			emailMatches,
			emailVerified: session?.user.emailVerified ?? false,
		},
	};
}
