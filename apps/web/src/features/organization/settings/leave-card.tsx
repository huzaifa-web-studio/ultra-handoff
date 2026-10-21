/**
 * Leave organization card.
 *
 * Why the ownership check: Better Auth refuses to remove the last owner, so
 * the card asks for the owner list first and explains the blocker instead of
 * letting the user press a button that can only fail.
 *
 * Used by: src/routes/_app/$orgSlug.settings.tsx.
 */

import { Button } from "@org/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@org/ui/components/card";
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@org/ui/components/dialog";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { authClient } from "#/features/auth/client";
import { broadcastAuth } from "#/features/auth/sync";
import { isOrganizationOwner } from "../permissions";
import { useSwitchOrganization } from "../switch";
import { openSwitchBlockedDialog } from "../switch-blocked-store";
import { getBlockingOperation } from "../switch-guard";
import { useLeaveOrganization, useOrganizationOwners } from "./hooks";

type LeaveCardProps = {
	organization: {
		id: string;
		name: string;
		slug: string;
	};
	role: string | null;
};

export function LeaveCard({ organization, role }: LeaveCardProps) {
	const navigate = useNavigate();
	const switchOrganization = useSwitchOrganization();
	const leaveOrganization = useLeaveOrganization();
	const isOwner = isOrganizationOwner(role);
	const ownersQuery = useOrganizationOwners(organization.id, isOwner);
	const [confirmOpen, setConfirmOpen] = useState(false);

	const ownerCount = ownersQuery.data?.length ?? 0;
	const isSoleOwner = isOwner && ownersQuery.isSuccess && ownerCount <= 1;
	const ownershipUnknown = isOwner && ownersQuery.isPending;

	async function handleLeave() {
		// Leaving is a switch away from this workspace. Block it while work is
		// still running here.
		const block = getBlockingOperation(organization.id);
		if (block) {
			setConfirmOpen(false);
			openSwitchBlockedDialog({
				title: "Can't leave right now",
				reason: block.reason,
			});
			return;
		}

		try {
			await leaveOrganization.mutateAsync(organization.id);
		} catch {
			// The mutation error is rendered below.
			return;
		}

		setConfirmOpen(false);

		// Pick another workspace in the same request chain so the layout guard
		// does not bounce the user through the create-organization screen.
		const { data: organizations } = await authClient.organization.list();
		const next = organizations?.find((item) => item.id !== organization.id);

		if (next) {
			try {
				// The old workspace is already gone, so the guard has nothing
				// left to protect. Force the switch and let the hook keep the
				// session, broadcast and URL in sync.
				await switchOrganization({
					organizationId: next.id,
					organizationSlug: next.slug,
					organizationName: next.name,
					force: true,
					previousOrganizationSlug: organization.slug,
					replace: true,
				});
			} catch {
				// The membership is already gone. If the switch fails, send the
				// user home instead of to a workspace they cannot load.
				await authClient.getSession();
				broadcastAuth("auth:org-changed", {
					previousSlug: organization.slug,
				});
				navigate({ to: "/", replace: true });
			}
		} else {
			await authClient.getSession();
			broadcastAuth("auth:org-changed", {
				previousSlug: organization.slug,
			});
			navigate({ to: "/", replace: true });
		}

		toast.success(`You left ${organization.name}.`);
	}

	return (
		<Card className="border border-danger">
			<CardHeader>
				<CardTitle className="text-danger">Leave organization</CardTitle>
				<CardDescription>
					Remove yourself from this workspace. This does not delete the
					organization or the work in it.
				</CardDescription>
			</CardHeader>

			<CardContent className="flex flex-col gap-4">
				{isSoleOwner && (
					<div className="flex flex-col gap-2 border border-danger bg-danger-bg p-3">
						<p className="text-sm text-danger">
							You are the only owner of {organization.name}.
						</p>
						<p className="text-xs text-danger">
							Promote another member to owner before you can leave.
						</p>
						<Button
							variant="outline"
							size="sm"
							className="self-start"
							onPress={() =>
								navigate({
									to: "/$orgSlug/settings/members",
									params: { orgSlug: organization.slug },
								})
							}
						>
							Open members
						</Button>
					</div>
				)}

				{ownersQuery.isError && isOwner && (
					<p role="alert" className="text-sm text-danger">
						{ownersQuery.error instanceof Error
							? ownersQuery.error.message
							: "Could not check the organization owners."}
					</p>
				)}

				{leaveOrganization.error && (
					<p role="alert" className="text-sm text-danger">
						{leaveOrganization.error instanceof Error
							? leaveOrganization.error.message
							: "Could not leave the organization."}
					</p>
				)}

				<div className="flex flex-wrap items-center gap-2">
					<Button
						variant="destructive"
						isDisabled={isSoleOwner || ownershipUnknown}
						loading={ownershipUnknown}
						onPress={() => {
							leaveOrganization.reset();
							setConfirmOpen(true);
						}}
					>
						{ownershipUnknown ? "Checking ownership..." : "Leave organization"}
					</Button>
					<p className="text-xs text-app-text-muted">
						You can be invited back at any time.
					</p>
				</div>
			</CardContent>

			<Dialog
				isOpen={confirmOpen}
				onOpenChange={(open) => {
					if (!open) {
						setConfirmOpen(false);
						leaveOrganization.reset();
					}
				}}
			>
				<DialogHeader>
					<DialogTitle>Leave {organization.name}?</DialogTitle>
				</DialogHeader>
				<DialogDescription>
					You will lose access to this workspace immediately. Any projects,
					deliveries or discussions assigned to you stay with the organization.
				</DialogDescription>
				<DialogFooter>
					<Button
						variant="outline"
						onPress={() => setConfirmOpen(false)}
						isDisabled={leaveOrganization.isPending}
					>
						Cancel
					</Button>
					<Button
						variant="destructive"
						loading={leaveOrganization.isPending}
						onPress={handleLeave}
					>
						Leave organization
					</Button>
				</DialogFooter>
			</Dialog>
		</Card>
	);
}
