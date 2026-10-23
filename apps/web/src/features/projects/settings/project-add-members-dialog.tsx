/**
 * Add people to a project.
 *
 * Why a dialog: adding members is a short batch action, not a page. It reuses
 * the workspace member list, keeps only people who are not on the project yet,
 * and assigns one role to the batch.
 *
 * Used by: project-members-page.tsx.
 */

import { Button } from "@org/ui/components/button";
import {
	Dialog,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@org/ui/components/dialog";
import { MultiSelect } from "@org/ui/components/multi-select";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@org/ui/components/select";
import { Skeleton } from "@org/ui/components/skeleton";
import { UserPlusIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { UserAvatar } from "#/components/user-avatar";
import { useMembers } from "#/features/members/hooks";
import { useBulkAddProjectMembers } from "../hooks";
import {
	isProjectRole,
	PROJECT_ROLE_LABELS,
	type ProjectRole,
} from "../permissions";

export function ProjectAddMembersDialog({
	orgSlug,
	projectId,
	projectName,
	existingUserIds,
	assignableRoles,
	isOpen,
	onOpenChange,
}: {
	orgSlug: string;
	projectId: string;
	projectName: string;
	existingUserIds: Set<string>;
	assignableRoles: ProjectRole[];
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const orgMembers = useMembers(orgSlug, isOpen);
	const addMember = useBulkAddProjectMembers(orgSlug, projectId);

	const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(
		new Set(),
	);
	const [role, setRole] = useState<ProjectRole>("member");
	const [error, setError] = useState<string | null>(null);

	// Reopening must never show a stale batch.
	useEffect(() => {
		if (isOpen) return;

		setSelectedUserIds(new Set());
		setRole("member");
		setError(null);
	}, [isOpen]);

	const available = useMemo(
		() =>
			(orgMembers.data?.members ?? [])
				.filter((member) => !existingUserIds.has(member.userId))
				.sort((a, b) => a.name.localeCompare(b.name)),
		[orgMembers.data?.members, existingUserIds],
	);

	async function handleAdd() {
		if (selectedUserIds.size === 0) return;

		setError(null);

		try {
			const response = await addMember.mutateAsync({
				userIds: [...selectedUserIds],
				role,
			});

			const added = response.results.filter(
				(item) => item.status === "added",
			).length;
			const skipped = response.results.length - added;

			if (added > 0) {
				toast.success(
					`${added} ${added === 1 ? "person" : "people"} added to ${projectName}.`,
				);
			}

			if (skipped > 0) {
				toast.warning(
					`${skipped} ${skipped === 1 ? "person was" : "people were"} skipped.`,
				);
			}

			setSelectedUserIds(new Set());
			onOpenChange(false);
		} catch (addError) {
			setError(
				addError instanceof Error
					? addError.message
					: "Could not add those people.",
			);
		}
	}

	return (
		<Dialog isOpen={isOpen} onOpenChange={onOpenChange} className="sm:max-w-lg">
			<DialogHeader>
				<DialogTitle>Add members</DialogTitle>
				<DialogDescription>
					Only people in this workspace can be added to {projectName}.
				</DialogDescription>
			</DialogHeader>

			{orgMembers.isPending ? (
				<div className="flex flex-col gap-3">
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-10 w-full" />
				</div>
			) : orgMembers.isError ? (
				<p role="alert" className="text-sm text-danger">
					Could not load the workspace members. Close and try again.
				</p>
			) : available.length === 0 ? (
				<p className="text-sm text-app-text-muted">
					Everyone in this workspace is already on the project.
				</p>
			) : (
				<div className="flex flex-col gap-4">
					<MultiSelect
						label="People to add"
						options={available.map((member) => ({
							value: member.userId,
							label: member.name,
							description: member.email,
							leading: (
								<UserAvatar size="sm" name={member.name} src={member.image} />
							),
						}))}
						selected={[...selectedUserIds]}
						onSelectedChange={(next) => setSelectedUserIds(new Set(next))}
						placeholder="Select people to add"
						searchPlaceholder="Search name or email"
						emptyMessage="No people match."
						disabled={addMember.isPending}
					/>

					<div className="flex flex-col gap-1">
						<span className="text-xs text-app-text-muted">
							Role for everyone selected
						</span>
						<Select
							aria-label="Project role for the new members"
							selectedKey={role}
							onSelectionChange={(key) => {
								if (isProjectRole(String(key))) {
									setRole(String(key) as ProjectRole);
								}
							}}
							isDisabled={addMember.isPending}
							className="w-full"
						>
							<SelectTrigger size="sm" className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{assignableRoles.map((assignable) => (
									<SelectItem key={assignable} id={assignable}>
										{PROJECT_ROLE_LABELS[assignable]}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					{error && (
						<p role="alert" className="text-sm text-danger">
							{error}
						</p>
					)}

					<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
						<Button
							type="button"
							variant="outline"
							onPress={() => onOpenChange(false)}
							isDisabled={addMember.isPending}
						>
							Cancel
						</Button>
						<Button
							onPress={handleAdd}
							loading={addMember.isPending}
							isDisabled={selectedUserIds.size === 0}
						>
							<UserPlusIcon data-icon="inline-start" />
							{selectedUserIds.size > 1
								? `Add ${selectedUserIds.size}`
								: "Add member"}
						</Button>
					</div>
				</div>
			)}
		</Dialog>
	);
}
