import { SidebarInset, SidebarProvider } from "@org/ui/components/sidebar";
import {
	createFileRoute,
	Outlet,
	useLocation,
	useNavigate,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { AppHeader } from "#/components/app-sidebar/app-header";
import { AppSidebar } from "#/components/app-sidebar/app-sidebar";
import { AppNotFound } from "#/components/app-sidebar/not-found";
import { authClient } from "#/features/auth/client";
import { broadcastAuth } from "#/features/auth/sync";
import { resetOrganizationDialog } from "#/features/organization/store";

export const Route = createFileRoute("/_app")({
	component: AppLayout,
	notFoundComponent: AppNotFound,
});

function AppLayout() {
	const navigate = useNavigate();
	const { pathname } = useLocation();
	const { data: session, isPending } = authClient.useSession();

	// Account settings belong to the user, not to an organization. Every other
	// screen under `_app` still needs an active organization, so the guard is
	// relaxed for this one path only.
	const needsOrganization = pathname !== "/account";
	const missingScope =
		isPending ||
		!session?.user ||
		(needsOrganization && !session.session?.activeOrganizationId);

	useEffect(() => {
		if (
			!isPending &&
			(!session?.user ||
				(needsOrganization && !session.session?.activeOrganizationId))
		) {
			navigate({ to: "/" });
		}
	}, [session, isPending, needsOrganization, navigate]);

	if (missingScope) {
		return null;
	}

	async function handleSignOut() {
		await authClient.signOut();
		broadcastAuth("auth:signed-out");
		// The next sign in is a fresh visit, so the organization prompt is
		// allowed to appear again.
		resetOrganizationDialog();
		navigate({ to: "/", search: {}, replace: true });
	}

	return (
		/*
		 * Fixed shell height, scrollable content.
		 *
		 * Why: pages that fill the viewport (the members and invitations
		 * tables) need a definite height to size their cards against. With the
		 * old `min-h-svh` shell and a document scroll, `h-full` on a page
		 * resolved against an auto parent, so a table simply grew with its
		 * rows. The shell now owns the viewport height and the content div is
		 * the scroll container, which gives `h-full` a real number to resolve
		 * against.
		 */
		<SidebarProvider className="h-svh overflow-hidden">
			<AppSidebar
				user={{
					name: session.user.name ?? session.user.email,
					email: session.user.email,
					avatar: session.user.image ?? undefined,
				}}
				onSignOut={handleSignOut}
			/>
			<SidebarInset>
				<AppHeader />
				{/*
				 * SidebarInset already renders the <main> landmark, so the
				 * scrollable content area is a plain div. It is also the scroll
				 * container for every app page, which keeps the header fixed.
				 */}
				<div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-8">
					<Outlet />
				</div>
			</SidebarInset>
		</SidebarProvider>
	);
}
