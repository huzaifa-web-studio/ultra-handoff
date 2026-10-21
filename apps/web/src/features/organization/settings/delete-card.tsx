/**
 * Delete organization card.
 *
 * Owner only. Why typed confirmation: deleting a workspace removes every
 * member, invitation and piece of work attached to it, so a single click is
 * too easy to trigger by accident.
 *
 * On success the API has already resolved the owner's next workspace with
 * `resolveSignInOrganization`. This card moves the browser there, or home when
 * there is nothing left.
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
import { Field, FieldDescription, FieldLabel } from "@org/ui/components/field";
import { Input } from "@org/ui/components/input";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { authClient } from "#/features/auth/client";
import { broadcastAuth } from "#/features/auth/sync";
import { useSwitchOrganization } from "../switch";
import { openSwitchBlockedDialog } from "../switch-blocked-store";
import { getBlockingOperation } from "../switch-guard";
import { type DeleteOrganizationResult, useDeleteOrganization } from "./hooks";

type DeleteOrganizationCardProps = {
	organization: {
		id: string;
		name: string;
		slug: string;
	};
};

export function DeleteOrganizationCard({
	organization,
}: DeleteOrganizationCardProps) {
	const navigate = useNavigate();
	const switchOrganization = useSwitchOrganization();
	const deleteOrganization = useDeleteOrganization();
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [confirmName, setConfirmName] = useState("");
	const [error, setError] = useState<string | null>(null);

	const nameMatches =
		confirmName.trim().toLowerCase() === organization.name.trim().toLowerCase();

	async function handleDelete() {
		if (!nameMatches) return;

		// Deleting removes the workspace under the running operation, so treat
		// it as an unsafe switch away from this organization.
		const block = getBlockingOperation(organization.id);
		if (block) {
			setConfirmOpen(false);
			openSwitchBlockedDialog({
				title: "Can't delete right now",
				reason: block.reason,
			});
			return;
		}

		setError(null);

		let result: DeleteOrganizationResult;

		try {
			result = await deleteOrganization.mutateAsync(organization.slug);
		} catch (deleteError) {
			setError(
				deleteError instanceof Error
					? deleteError.message
					: "Could not delete the organization.",
			);
			return;
		}

		setConfirmOpen(false);

		const { nextOrganizationId, nextSlug } = result;

		if (nextOrganizationId && nextSlug) {
			try {
				// The old workspace no longer exists, so there is nothing left
				// for the guard to protect. Force the switch and let the hook
				// keep the session, broadcast and URL in sync.
				await switchOrganization({
					organizationId: nextOrganizationId,
					organizationSlug: nextSlug,
					force: true,
					previousOrganizationSlug: organization.slug,
					replace: true,
				});
				toast.success(`${organization.name} was deleted.`);
				return;
			} catch {
				// Fall through to the home screen below.
			}
		}

		// The organization is gone. With no next workspace, or a failed switch,
		// home is the only safe destination.
		await authClient.getSession();
		broadcastAuth("auth:org-changed", {
			previousSlug: organization.slug,
		});
		navigate({ to: "/", replace: true });
		toast.success(`${organization.name} was deleted.`);
	}

	return (
		<Card className="border border-danger">
			<CardHeader>
				<CardTitle className="text-danger">Delete organization</CardTitle>
				<CardDescription>
					Permanently delete {organization.name} and everything connected to it.
					This action cannot be undone.
				</CardDescription>
			</CardHeader>

			<CardContent className="flex flex-col gap-4">
				<div className="flex flex-col gap-1">
					<p className="text-sm text-app-text-muted">
						All memberships, invitations and work in this workspace will be
						removed. The people in it will lose access immediately.
					</p>
				</div>

				<div>
					<Button
						variant="destructive"
						onPress={() => {
							deleteOrganization.reset();
							setError(null);
							setConfirmName("");
							setConfirmOpen(true);
						}}
					>
						Delete organization
					</Button>
				</div>
			</CardContent>

			<Dialog
				isOpen={confirmOpen}
				onOpenChange={(open) => {
					if (!open) {
						setConfirmOpen(false);
						deleteOrganization.reset();
					}
				}}
			>
				<DialogHeader>
					<DialogTitle>Delete {organization.name}?</DialogTitle>
				</DialogHeader>
				<DialogDescription>
					This permanently removes the organization, its memberships and its
					invitations. There is no way to recover it afterwards.
				</DialogDescription>

				<form
					onSubmit={(event) => {
						event.preventDefault();
						event.stopPropagation();
						void handleDelete();
					}}
					className="flex flex-col gap-4"
				>
					<Field>
						<FieldLabel htmlFor="delete-organization-name">
							Type the organization name to confirm
						</FieldLabel>
						<Input
							id="delete-organization-name"
							type="text"
							autoComplete="off"
							spellCheck={false}
							value={confirmName}
							onChange={(event) => setConfirmName(event.target.value)}
							placeholder={organization.name}
						/>
						<FieldDescription>
							Type{" "}
							<span className="font-medium text-app-text">
								{organization.name}
							</span>{" "}
							exactly to enable deletion.
						</FieldDescription>
					</Field>

					{error && (
						<p role="alert" className="text-sm text-danger">
							{error}
						</p>
					)}

					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onPress={() => setConfirmOpen(false)}
							isDisabled={deleteOrganization.isPending}
						>
							Cancel
						</Button>
						<Button
							type="submit"
							variant="destructive"
							loading={deleteOrganization.isPending}
							isDisabled={!nameMatches || deleteOrganization.isPending}
						>
							Delete organization
						</Button>
					</DialogFooter>
				</form>
			</Dialog>
		</Card>
	);
}
