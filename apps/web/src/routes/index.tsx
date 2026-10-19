import { Button } from "@org/ui/components/button";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { AuthDialog } from "#/features/auth/auth-dialog";
import { authClient } from "#/features/auth/client";
import { openSignIn, openSignUp } from "#/features/auth/store";
import { OrganizationDialog } from "#/features/organization/organization-dialog";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
	const navigate = useNavigate();
	const { data: session } = authClient.useSession();
	const hasOrg = !!session?.user && !!session.session?.activeOrganizationId;

	useEffect(() => {
		if (hasOrg) {
			navigate({ to: "/app" });
		}
	}, [hasOrg, navigate]);

	return (
		<div className="flex min-h-screen flex-col">
			<header className="flex items-center justify-between border-b border-app-border px-6 py-4">
				<span className="font-display text-lg font-bold text-app-text">
					Ultra Handoff
				</span>
				<div className="flex gap-2">
					{session?.user ? (
						<Button
							variant="outline"
							onPress={async () => {
								await authClient.signOut();
							}}
						>
							Sign out
						</Button>
					) : (
						<>
							<Button variant="outline" onPress={openSignIn}>
								Sign in
							</Button>
							<Button onPress={openSignUp}>Sign up</Button>
						</>
					)}
				</div>
			</header>
			<main className="flex flex-1 items-center justify-center">
				<h1 className="text-5xl font-bold text-app-text">Ultra Handoff</h1>
			</main>

			<AuthDialog />
			<OrganizationDialog />
		</div>
	);
}
