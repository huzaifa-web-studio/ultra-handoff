import { Button } from "@org/ui/components/button";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useSelector } from "@tanstack/react-store";
import { useEffect } from "react";
import { HomeHeader } from "#/components/home-header";
import { AuthDialog } from "#/features/auth/auth-dialog";
import { authClient } from "#/features/auth/client";
import { openSignIn, openSignUp } from "#/features/auth/store";
import { broadcastAuth } from "#/features/auth/sync";
import { OrganizationDialog } from "#/features/organization/organization-dialog";
import {
	openOrganizationDialog,
	organizationDialogStore,
	resetOrganizationDialog,
} from "#/features/organization/store";

export const Route = createFileRoute("/")({
	component: Home,
});

function Home() {
	const navigate = useNavigate();
	const { data: session } = authClient.useSession();
	const { data: activeOrg } = authClient.useActiveOrganization();

	// A session without a confirmed address cannot do anything useful here.
	// See the guard below, which moves it to the page that owns the resend.
	const isUnverified = !!session?.user && !session.user.emailVerified;

	const hasOrg =
		!!session?.user && !!session.session?.activeOrganizationId && !isUnverified;

	useEffect(() => {
		if (isUnverified) {
			navigate({ to: "/verify-email", search: {} });
		}
	}, [isUnverified, navigate]);

	useEffect(() => {
		if (hasOrg && activeOrg?.slug) {
			navigate({ to: "/$orgSlug", params: { orgSlug: activeOrg.slug } });
		}
	}, [hasOrg, activeOrg, navigate]);

	const isSignedIn = !!session?.user;
	const needsOrg =
		isSignedIn && !session.session?.activeOrganizationId && !isUnverified;

	// The dismissal only has to survive the current visit, so it lives in the
	// dialog store. A reload starts a fresh visit and the prompt returns.
	const { wasDismissed } = useSelector(organizationDialogStore);

	useEffect(() => {
		if (!needsOrg || wasDismissed) return;
		openOrganizationDialog();
	}, [needsOrg, wasDismissed]);

	async function handleSignOut() {
		await authClient.signOut();
		broadcastAuth("auth:signed-out");
		// The next sign in is a fresh visit, so the organization prompt is
		// allowed to appear again.
		resetOrganizationDialog();
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
