import { Button } from "@org/ui/components/button";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { HomeHeader } from "#/components/home-header";
import { AuthDialog } from "#/features/auth/auth-dialog";
import { authClient } from "#/features/auth/client";
import { openSignIn, openSignUp } from "#/features/auth/store";
import { OrganizationDialog } from "#/features/organization/organization-dialog";
import { openOrganizationDialog } from "#/features/organization/store";
import { broadcastAuth } from "#/features/auth/sync";

export const Route = createFileRoute("/")({
	/**
	 * The verification email redirects here with `verified=1`.
	 *
	 * Why validate: the flag comes from a URL, so it has to be parsed into a
	 * typed boolean before the page can render a confirmation instead of
	 * silently dropping the user on the home screen. The key stays optional so
	 * every other link to `/` does not have to pass a search object.
	 */
	validateSearch: (search: Record<string, unknown>): { verified?: boolean } => {
		const verified = search.verified === "1" || search.verified === true;

		return verified ? { verified } : {};
	},
	component: Home,
});

function Home() {
	const navigate = useNavigate();
	const { verified } = Route.useSearch();
	const { data: session } = authClient.useSession();
	const { data: activeOrg } = authClient.useActiveOrganization();
	const hasOrg = !!session?.user && !!session.session?.activeOrganizationId;

	const verifiedToastShown = useRef(false);

	useEffect(() => {
		if (verified && !verifiedToastShown.current) {
			verifiedToastShown.current = true;
			toast.success("Email verified. Your account is ready.");
			// Strip `?verified=1` so the flag does not linger in the URL.
			navigate({ to: "/", search: {}, replace: true });
		}
		if (!verified) {
			verifiedToastShown.current = false;
		}
	}, [verified, navigate]);

	useEffect(() => {
		if (hasOrg && activeOrg?.slug) {
			navigate({ to: "/$orgSlug", params: { orgSlug: activeOrg.slug } });
		}
	}, [hasOrg, activeOrg, navigate]);

	const isSignedIn = !!session?.user;
	const needsOrg = isSignedIn && !session.session?.activeOrganizationId;

	// Dialog open state is managed by their own stores/components now.

	async function handleSignOut() {
		await authClient.signOut();
		broadcastAuth("auth:signed-out");
		// Drop `?verified=1` so the verification banner does not linger after
		// signing out.
		navigate({ to: "/", search: {}, replace: true });
	}

	return (
		<div className="flex min-h-screen flex-col">
			<HomeHeader
				session={session ?? null}
				needsOrg={needsOrg}
				onSignOut={handleSignOut}
				onOpenSignIn={openSignIn}
				onOpenSignUp={openSignUp}
			/>
			{/* Confirmation for the emailed verification link is shown via toast. */}
			<main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
				{needsOrg ? (
					<>
						<div className="flex max-w-md flex-col gap-3">
							<h1 className="text-3xl font-bold text-app-text">
								Create an organization to get started
							</h1>
							<p className="text-app-text-muted">
								Handoff is built around organizations. Create one to unlock
								every feature, including projects, scope approvals, and
								deliveries.
							</p>
						</div>
						<Button size="lg" onPress={() => openOrganizationDialog()}>
							Create organization
						</Button>
					</>
				) : (
					<h1 className="text-5xl font-bold text-app-text">Ultra Handoff</h1>
				)}
			</main>

			<AuthDialog />
			<OrganizationDialog />
		</div>
	);
}
