import { Button } from "@org/ui/components/button";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { AuthDialog } from "#/features/auth/auth-dialog";
import { authClient } from "#/features/auth/client";
import { openSignIn, openSignUp } from "#/features/auth/store";
import { OrganizationDialog } from "#/features/organization/organization-dialog";

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

	useEffect(() => {
		if (hasOrg && activeOrg?.slug) {
			navigate({ to: "/$orgSlug", params: { orgSlug: activeOrg.slug } });
		}
	}, [hasOrg, activeOrg, navigate]);

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
			{/* Confirmation for the emailed verification link. */}
			{verified && (
				<output className="block border-b border-success bg-success-bg px-6 py-3 text-center text-sm text-success">
					Email verified. Your account is ready.
				</output>
			)}
			<main className="flex flex-1 items-center justify-center">
				<h1 className="text-5xl font-bold text-app-text">Ultra Handoff</h1>
			</main>

			<AuthDialog />
			<OrganizationDialog />
		</div>
	);
}
