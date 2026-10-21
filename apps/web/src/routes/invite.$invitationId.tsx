/**
 * Public invitation landing page.
 *
 * Why outside `_app`: the invitee usually has no session and no active
 * organization, so the app layout's guard would bounce them home. This page
 * explains the invitation, offers passwordless sign in, and only then accepts.
 *
 * Used by: the link in the organization invitation email.
 */

import { createFileRoute } from "@tanstack/react-router";

import { AuthDialog } from "#/features/auth/auth-dialog";
import { InviteAcceptCard } from "#/features/invitations/invite-accept-card";

export const Route = createFileRoute("/invite/$invitationId")({
	validateSearch: (search: Record<string, unknown>): { verify?: string } => ({
		verify: search.verify === "1" ? "1" : undefined,
	}),
	head: () => ({
		meta: [
			{ title: "Invitation | Ultra Handoff" },
			// Invitation links are personal and single use. Never index them.
			{ name: "robots", content: "noindex" },
		],
	}),
	component: InvitePage,
});

function InvitePage() {
	const { invitationId } = Route.useParams();
	const { verify } = Route.useSearch();

	return (
		<div className="flex min-h-screen flex-col bg-app-canvas">
			<header className="border-b border-app-border px-6 py-4">
				<span className="font-display text-lg font-bold text-app-text">
					Ultra Handoff
				</span>
			</header>

			<main className="flex flex-1 items-center justify-center px-6 py-12">
				<InviteAcceptCard invitationId={invitationId} verify={verify === "1"} />
			</main>

			{/* Mounted here so "Sign in instead" has a dialog to open. */}
			<AuthDialog />
		</div>
	);
}
