import { SidebarInset, SidebarProvider } from "@org/ui/components/sidebar";
import {
	createFileRoute,
	Outlet,
	useLocation,
	useMatches,
	useNavigate,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { AppHeader } from "#/components/app-sidebar/app-header";
import { AppSidebar } from "#/components/app-sidebar/app-sidebar";
import { AppNotFound } from "#/components/app-sidebar/not-found";
import { authClient } from "#/features/auth/client";
import { broadcastAuth } from "#/features/auth/sync";
import { decideActiveWorkspace } from "#/features/organization/active-workspace";
import { resetOrganizationDialog } from "#/features/organization/store";

export const Route = createFileRoute("/_app")({
	component: AppLayout,
	notFoundComponent: AppNotFound,
});

/**
 * Read `$orgSlug` from the matched routes, if the current URL has one.
 *
 * The layout renders above the `$orgSlug` route, so `useParams` on this
 * component carries no params. The matched child route holds the slug.
 */
function findUrlOrgSlug(
	matches: ReadonlyArray<{ params: unknown }>,
): string | undefined {
	for (const match of matches) {
		if (!match.params || typeof match.params !== "object") continue;

		const slug = (match.params as { orgSlug?: unknown }).orgSlug;

		if (typeof slug === "string" && slug.length > 0) return slug;
	}

	return undefined;
}

function AppLayout() {
	const navigate = useNavigate();
	const { pathname } = useLocation();
	const matches = useMatches();
	const { data: session, isPending } = authClient.useSession();
	const { data: activeOrganization, isPending: activeOrganizationPending } =
		authClient.useActiveOrganization();

	// Account settings belong to the user, not to an organization. Every other
	// screen under `_app` still needs an active organization, so the guard is
	// relaxed for this one path only.
	const needsOrganization = pathname !== "/account";

	// A session that exists without a confirmed address may not render any
	// workspace screen. The verify page is the only place with a resend action,
	// so an unverified visitor is sent there instead of the marketing page.
	const unverified = !!session?.user && !session.user.emailVerified;

	const missingScope =
		isPending ||
		!session?.user ||
		unverified ||
		(needsOrganization && !session.session?.activeOrganizationId);

	/*
	 * One active organization per session. The shell, the breadcrumb and the
	 * settings page all read the active organization, so a URL naming another
	 * one is sent back to it instead of rendering a second open workspace.
	 */
	const activeOrgSlug = activeOrganization?.slug ?? null;
	const workspaceDecision = decideActiveWorkspace({
		urlSlug: findUrlOrgSlug(matches),
		activeSlug: activeOrgSlug,
		activePending: activeOrganizationPending,
	});
	const redirectingWorkspace = workspaceDecision === "redirect";
	const waitingForWorkspace = workspaceDecision === "wait";

	useEffect(() => {
		if (isPending) return;

		if (!session?.user) {
			navigate({ to: "/" });
			return;
		}

		if (unverified) {
			navigate({ to: "/verify-email", search: {} });
			return;
		}

		if (needsOrganization && !session.session?.activeOrganizationId) {
			navigate({ to: "/" });
			return;
		}

		/*
		 * A stale bookmark, an old link or a hand edited address is replaced
		 * with the active workspace. `replace` keeps the other slug out of the
		 * history stack, so Back does not bounce between two workspaces.
		 */
		if (redirectingWorkspace && activeOrgSlug) {
			navigate({
				to: "/$orgSlug",
				params: { orgSlug: activeOrgSlug },
				replace: true,
			});
		}
	}, [
		session,
		isPending,
		needsOrganization,
		unverified,
		redirectingWorkspace,
		activeOrgSlug,
		navigate,
	]);

	// `waitingForWorkspace` keeps the URL organization from flashing on screen
	// while the active one is still loading.
	if (missingScope || redirectingWorkspace || waitingForWorkspace) {
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
