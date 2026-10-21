/**
 * Organization General settings page.
 *
 * Why a stack of cards: the page has two independent concerns, the editable
 * organization profile and the membership action that removes the current
 * user. Each card owns its form and mutations, and this route only composes
 * them and supplies the caller's role.
 *
 * Used by: the `_app` layout, reachable from the organization sidebar.
 */

import { Skeleton } from "@org/ui/components/skeleton";
import { createFileRoute } from "@tanstack/react-router";

import { authClient } from "#/features/auth/client";
import {
	isOrganizationEditor,
	isOrganizationOwner,
	organizationRoleLabel,
} from "#/features/organization/permissions";
import { DeleteOrganizationCard } from "#/features/organization/settings/delete-card";
import { GeneralCard } from "#/features/organization/settings/general-card";
import { LeaveCard } from "#/features/organization/settings/leave-card";

export const Route = createFileRoute("/_app/$orgSlug/settings")({
	component: SettingsPage,
	staticData: { breadcrumb: "Settings" },
});

function SettingsPage() {
	const { data: organization, isPending: organizationPending } =
		authClient.useActiveOrganization();
	const { data: member, isPending: memberPending } =
		authClient.useActiveMember();

	if (organizationPending || memberPending || !organization) {
		return <SettingsSkeleton />;
	}

	const role = member?.role ?? null;
	const canEdit = isOrganizationEditor(role);

	return (
		<div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
			<header className="flex flex-col gap-2">
				<div className="flex flex-wrap items-center gap-3">
					<h1 className="text-2xl font-bold text-app-text">General settings</h1>
					<span className="inline-flex items-center bg-app-selected px-2 py-0.5 text-xs font-semibold tracking-wide text-app-text uppercase">
						{organizationRoleLabel(role)}
					</span>
				</div>
				<p className="text-app-text-muted">
					Manage how your organization appears and the address your team uses to
					reach it.
				</p>
			</header>

			<GeneralCard
				organization={organization}
				canEdit={canEdit}
				onChanged={async () => {
					// Keep the session copy in sync with the organization row.
					// The active organization atom refreshes itself for name and
					// slug, and explicitly after a logo change.
					await authClient.getSession();
				}}
			/>

			<LeaveCard organization={organization} role={role} />

			{isOrganizationOwner(role) && (
				<DeleteOrganizationCard organization={organization} />
			)}
		</div>
	);
}

/** Loading shape that matches the real cards, so the page does not jump. */
function SettingsSkeleton() {
	return (
		<div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
			<div className="flex flex-col gap-2">
				<Skeleton className="h-8 w-48" />
				<Skeleton className="h-4 w-80" />
			</div>
			<Skeleton className="h-96 w-full" />
			<Skeleton className="h-48 w-full" />
		</div>
	);
}
