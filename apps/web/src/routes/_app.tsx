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
		navigate({ to: "/", search: {}, replace: true });
	}

	return (
		<SidebarProvider>
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
				 * scrollable content area is a plain div. Keeping it separate
				 * from the sticky header means only the content scrolls.
				 */}
				<div className="min-w-0 flex-1 p-8">
					<Outlet />
				</div>
			</SidebarInset>
		</SidebarProvider>
	);
}
