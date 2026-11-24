/**
 * Invitation accept links.
 *
 * Why this file: sending the magic link applies the email and IP rate limits
 * and the cooldown, then asks Better Auth to send the mail. Those steps belong
 * together.
 *
 * Used by: `routes/invitations.ts`.
 */

import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { auth } from "../../auth/auth";
import {
	MAGIC_LINK_COOLDOWN_SECONDS,
	MAGIC_LINK_IP_LIMIT,
	MAGIC_LINK_IP_WINDOW_SECONDS,
	MAGIC_LINK_TOTAL_LIMIT,
	ORG_INVITATION_TTL_SECONDS,
} from "../../auth/permissions";
import { adminDb } from "../../db";
import { invitation } from "../../db/auth-schema";
import { serverEnv } from "../../lib/env";
import { consumeRateLimit, startCooldown } from "../../lib/rate-limit";
import { deriveStatus, nameFromEmail } from "./helpers";

/**
 * Send a magic link to the invited address.
 *
 * The address always comes from the invitation row, never from the request, so
 * the endpoint cannot be used to email an arbitrary stranger. Three bounds sit
 * on top of that:
 *   1. a total cap per invitation, because the id is a bearer token that can
 *      leak and one link can be requested again and again;
 *   2. a per-IP cap, so one client cannot walk many leaked ids;
 *   3. the original 60 second cooldown, which keeps retries friendly.
 *
 * The IP comes from the socket address passed by the route, not from a header
 * the caller can set.
 */
export async function sendInvitationMagicLink(
	invitationId: string,
	headers: Headers,
	clientIp: string | null = null,
): Promise<{ status: "sent" }> {
	const [row] = await adminDb
		.select()
		.from(invitation)
		.where(eq(invitation.id, invitationId))
		.limit(1);

	if (!row) {
		throw new APIError("NOT_FOUND", {
			message: "This invitation link is not valid.",
		});
	}

	const status = deriveStatus(row);

	if (status === "expired") {
		throw new APIError("BAD_REQUEST", {
			message: "This invitation has expired. Ask an admin to resend it.",
		});
	}

	if (status !== "pending") {
		throw new APIError("BAD_REQUEST", {
			message: "This invitation is no longer available.",
		});
	}

	// A leaked link should not mail the invitee indefinitely.
	const withinTotal = await consumeRateLimit(
		`invite-magic-total:${invitationId}`,
		MAGIC_LINK_TOTAL_LIMIT,
		ORG_INVITATION_TTL_SECONDS,
	);

	if (!withinTotal) {
		throw new APIError("TOO_MANY_REQUESTS", {
			message:
				"This invitation has requested too many sign-in links. Ask an admin to resend it.",
		});
	}

	// Bound one client across many invitations. Skipped when the socket
	// address is unavailable, because a shared "unknown" bucket would block
	// unrelated invitees.
	if (clientIp) {
		const withinIp = await consumeRateLimit(
			`invite-magic-ip:${clientIp}`,
			MAGIC_LINK_IP_LIMIT,
			MAGIC_LINK_IP_WINDOW_SECONDS,
		);

		if (!withinIp) {
			throw new APIError("TOO_MANY_REQUESTS", {
				message: "Too many sign-in link requests. Try again later.",
			});
		}
	}

	const allowed = await startCooldown(
		`invite-magic:${invitationId}`,
		MAGIC_LINK_COOLDOWN_SECONDS,
	);

	if (!allowed) {
		throw new APIError("TOO_MANY_REQUESTS", {
			message: "A sign-in link was just sent. Check your inbox.",
		});
	}

	await auth.api.signInMagicLink({
		body: {
			email: row.email,
			name: nameFromEmail(row.email),
			callbackURL: `${serverEnv.webUrl}/invite/${encodeURIComponent(invitationId)}?verify=1`,
			errorCallbackURL: `${serverEnv.webUrl}/auth/error`,
			metadata: { invitationId },
		},
		headers,
	});

	return { status: "sent" };
}
