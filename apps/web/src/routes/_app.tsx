import { SidebarInset, SidebarProvider } from "@org/ui/components/sidebar";
import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { AppHeader } from "#/components/app-sidebar/app-header";
import { AppSidebar } from "#/components/app-sidebar/app-sidebar";
import { AppNotFound } from "#/components/app-sidebar/not-found";
import { authClient } from "#/features/auth/client";

export const Route = createFileRoute("/_app")({
	component: AppLayout,
	notFoundComponent: AppNotFound,
});

function AppLayout() {
	const navigate = useNavigate();
	const { data: session, isPending } = authClient.useSession();

	useEffect(() => {
		if (
			!isPending &&
			(!session?.user || !session.session?.activeOrganizationId)
		) {
			navigate({ to: "/" });
		}
	}, [session, isPending, navigate]);

	if (isPending || !session?.user || !session.session?.activeOrganizationId) {
		return null;
	}

	async function handleSignOut() {
		await authClient.signOut();
		navigate({ to: "/" });
	}

	return (
		<SidebarProvider>
			<AppSidebar
				user={{
					name: session.user.name ?? session.user.email,
					email: session.user.email,
					avatar: session.user.image ?? "/avatars/shadcn.jpg",
				}}
				onSignOut={handleSignOut}
			/>
			<SidebarInset>
				<AppHeader />
				<main className="flex-1 p-8">
					<Outlet />
				</main>
			</SidebarInset>
		</SidebarProvider>
	);
}
