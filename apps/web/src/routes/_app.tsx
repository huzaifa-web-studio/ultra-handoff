import {
	SidebarInset,
	SidebarProvider,
	SidebarTrigger,
} from "@org/ui/components/sidebar";
import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { AppSidebar } from "#/components/app-sidebar/app-sidebar";
import { authClient } from "#/features/auth/client";

export const Route = createFileRoute("/_app")({ component: AppLayout });

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
				<header className="flex h-14 items-center justify-between border-b border-app-border px-4">
					<div className="flex items-center gap-2">
						<SidebarTrigger />
						<span className="text-sm font-semibold text-app-text">
							Dashboard
						</span>
					</div>
				</header>
				<main className="flex-1 p-8">
					<Outlet />
				</main>
			</SidebarInset>
		</SidebarProvider>
	);
}
