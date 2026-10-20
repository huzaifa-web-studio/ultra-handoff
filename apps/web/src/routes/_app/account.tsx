/**
 * Account settings page.
 *
 * Why this layout: account data is user scoped, not organization scoped, so
 * the page is a simple stack of sections rather than a tenant screen. Each
 * section owns its own form and mutations, and this file only composes them.
 *
 * Used by: the `_app` layout, reachable from the sidebar user menu.
 */

import { Skeleton } from "@org/ui/components/skeleton";
import { createFileRoute } from "@tanstack/react-router";
import { DangerCard } from "#/features/account/danger-card";
import { useLinkedAccounts } from "#/features/account/hooks";
import { PasswordCard } from "#/features/account/password-card";
import { ProfileCard } from "#/features/account/profile-card";
import { SignInMethodsCard } from "#/features/account/sign-in-methods";
import { authClient } from "#/features/auth/client";

export const Route = createFileRoute("/_app/account")({
	component: AccountPage,
	staticData: { breadcrumb: "Account" },
});

function AccountPage() {
	const { data: session, isPending, refetch } = authClient.useSession();
	// Shared query key with SignInMethodsCard, so this does not add a request.
	const accountsQuery = useLinkedAccounts();

	const hasPassword = Boolean(
		accountsQuery.data?.some((account) => account.providerId === "credential"),
	);

	if (isPending || !session?.user) {
		return <AccountSkeleton />;
	}

	return (
		<div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
			<header className="flex flex-col gap-2">
				<h1 className="text-2xl font-bold text-app-text">Account</h1>
				<p className="text-app-text-muted">
					Manage your profile, sign-in methods and password.
				</p>
			</header>

			<ProfileCard user={session.user} onUpdated={refetch} />

			<SignInMethodsCard hasPassword={hasPassword} />

			<PasswordCard
				hasPassword={hasPassword}
				isLoading={accountsQuery.isPending}
				onChanged={async () => {
					await accountsQuery.refetch();
				}}
			/>

			<DangerCard email={session.user.email} />
		</div>
	);
}

/** Loading shape that matches the real cards, so the page does not jump. */
function AccountSkeleton() {
	return (
		<div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
			<div className="flex flex-col gap-2">
				<Skeleton className="h-8 w-40" />
				<Skeleton className="h-4 w-72" />
			</div>
			<Skeleton className="h-72 w-full" />
			<Skeleton className="h-56 w-full" />
			<Skeleton className="h-64 w-full" />
			{/* Danger zone */}
			<Skeleton className="h-64 w-full" />
		</div>
	);
}
