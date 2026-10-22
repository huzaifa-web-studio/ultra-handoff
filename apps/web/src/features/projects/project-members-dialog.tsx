/**
 * Project members dialog.
 *
 * Why one dialog: adding people, changing a role, removing one person and
 * removing a batch all act on the same list, so they share one fetch and one
 * invalidation. The picker is a multi select fed by the workspace member query,
 * because a project member must already belong to the organization and adding
 * or removing a team is usually a batch.
 *
 * Organization owner rows are locked: the API treats them as project owners
 * unconditionally, so offering a role select or a remove button would promise
 * something it cannot do.
 *
 * Used by: routes/_app/$orgSlug.projects.tsx.
 */

import { Button } from "@org/ui/components/button";
import { Checkbox } from "@org/ui/components/checkbox";
import {
	Dialog,
	DialogDescription,
	DialogFooter,
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
import { RefreshCwIcon, Trash2Icon, UserPlusIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { BulkResultList } from "#/components/bulk-result-list";
import { UserAvatar } from "#/components/user-avatar";
import { useMembers } from "#/features/members/hooks";
import type {
	ProjectBulkItemResult,
	ProjectMemberRow,
	ProjectRow,
} from "./api";
import {
	useBulkAddProjectMembers,
	useBulkRemoveProjectMembers,
	useProjectDetail,
	useUpdateProjectMemberRole,
} from "./hooks";
import {
	canManageProjectTarget,
	isProjectRole,
	PROJECT_ROLE_LABELS,
	type ProjectRole,
} from "./permissions";
import { ProjectRoleChip } from "./project-role-chip";

type ProjectMembersDialogProps = {
	orgSlug: string;
	project: ProjectRow | null;
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
};

export function ProjectMembersDialog({
	orgSlug,
	project,
	isOpen,
	onOpenChange,
}: ProjectMembersDialogProps) {
	const projectId = project?.id ?? "";
	const detail = useProjectDetail(orgSlug, project?.id ?? null, isOpen);
	const orgMembers = useMembers(orgSlug, isOpen);

	const addMember = useBulkAddProjectMembers(orgSlug, projectId);
	const updateRole = useUpdateProjectMemberRole(orgSlug, projectId);
	const removeMembers = useBulkRemoveProjectMembers(orgSlug, projectId);

	/** People ticked in the picker, added in one request. */
	const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(
		new Set(),
	);
	const [addRole, setAddRole] = useState<ProjectRole>("member");
	const [results, setResults] = useState<ProjectBulkItemResult[] | null>(null);
	/** Existing members ticked for removal. */
	const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(
		new Set(),
	);
	/** Members waiting for the inline removal confirmation. */
	const [removeTargets, setRemoveTargets] = useState<ProjectMemberRow[]>([]);
	const [removeResults, setRemoveResults] = useState<
		ProjectBulkItemResult[] | null
	>(null);
	const [error, setError] = useState<string | null>(null);

	// Reset the add form, the member selection and any pending inline
	// confirmation on close, so reopening never shows a stale batch.
	useEffect(() => {
		if (isOpen) return;
		setSelectedUserIds(new Set());
		setAddRole("member");
		setResults(null);
		setSelectedMemberIds(new Set());
		setRemoveTargets([]);
		setRemoveResults(null);
		setError(null);
	}, [isOpen]);

	const members = detail.data?.members ?? [];
	const viewer = detail.data?.viewer;

	const memberUserIds = useMemo(
		() => new Set(members.map((member) => member.userId)),
		[members],
	);

	// Only people already in the workspace, and not already on the project.
	const available = useMemo(
		() =>
			(orgMembers.data?.members ?? [])
				.filter((member) => !memberUserIds.has(member.userId))
				.sort((a, b) => a.name.localeCompare(b.name)),
		[orgMembers.data?.members, memberUserIds],
	);

	const roleOptions = viewer?.assignableRoles ?? [];

	// Only these rows can be removed: never yourself, never an organization
	// owner, and never someone above the viewer's project role.
	const removableMembers = useMemo(() => {
		if (!viewer?.canManageMembers) return [];

		return members.filter(
			(member) =>
				!member.isOrganizationOwner &&
				!member.isSelf &&
				canManageProjectTarget(viewer.projectRole, member.role),
		);
	}, [members, viewer]);

	const selectedMembers = removableMembers.filter((member) =>
		selectedMemberIds.has(member.userId),
	);
	const allRemovableSelected =
		removableMembers.length > 0 &&
		removableMembers.every((member) => selectedMemberIds.has(member.userId));

	/** Toggle one existing member without dropping the rest of the batch. */
	function toggleMemberSelected(userId: string) {
		setSelectedMemberIds((previous) => {
			const next = new Set(previous);

			if (next.has(userId)) {
				next.delete(userId);
			} else {
				next.add(userId);
			}

			return next;
		});
	}

	/** Select or clear every member the viewer is allowed to remove. */
	function toggleAllRemovable() {
		setSelectedMemberIds((previous) => {
			const next = new Set(previous);

			if (allRemovableSelected) {
				for (const member of removableMembers) next.delete(member.userId);
			} else {
				for (const member of removableMembers) next.add(member.userId);
			}

			return next;
		});
	}

	async function handleAdd() {
		if (selectedUserIds.size === 0) return;

		setError(null);
		setResults(null);

		const userIds = [...selectedUserIds];

		try {
			const response = await addMember.mutateAsync({ userIds, role: addRole });
			setResults(response.results);

			const added = response.results.filter(
				(item) => item.status === "added",
			).length;
			const skipped = response.results.length - added;

			if (added > 0) {
				toast.success(
					`${added} member${added === 1 ? "" : "s"} added to the project.`,
				);
			}

			if (skipped > 0) {
				toast.warning(`${skipped} member${skipped === 1 ? "" : "s"} skipped.`, {
					description: "The list below says why for each person.",
				});
			}

			setSelectedUserIds(new Set());
		} catch (addError) {
			setError(
				addError instanceof Error
					? addError.message
					: "Could not add those people.",
			);
		}
	}

	async function handleRoleChange(member: ProjectMemberRow, role: ProjectRole) {
		if (role === member.role) return;

		setError(null);

		try {
			await updateRole.mutateAsync({ userId: member.userId, role });
			toast.success(`${member.name} is now ${PROJECT_ROLE_LABELS[role]}.`);
		} catch (roleError) {
			setError(
				roleError instanceof Error
					? roleError.message
					: "Could not change that role.",
			);
		}
	}

	async function handleRemove() {
		if (removeTargets.length === 0) return;

		setError(null);
		setRemoveResults(null);

		try {
			const response = await removeMembers.mutateAsync(
				removeTargets.map((member) => member.userId),
			);

			setRemoveResults(response.results);

			const removed = response.results.filter(
				(item) => item.status === "removed",
			).length;
			const skipped = response.results.length - removed;

			if (removed > 0) {
				toast.success(
					`${removed} member${removed === 1 ? "" : "s"} removed from the project.`,
				);
			}

			if (skipped > 0) {
				toast.warning(`${skipped} member${skipped === 1 ? "" : "s"} skipped.`, {
					description: "The list below says why for each person.",
				});
			}

			setRemoveTargets([]);
			setSelectedMemberIds(new Set());
		} catch (removeError) {
			setError(
				removeError instanceof Error
					? removeError.message
					: "Could not remove those people.",
			);
		}
	}

	return (
		<Dialog
			isOpen={isOpen}
			onOpenChange={onOpenChange}
			className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl"
		>
			<DialogHeader>
				<DialogTitle>Project members</DialogTitle>
				<DialogDescription>
					Only people listed here can open {project?.name ?? "this project"}.
					Organization owners are always project owners.
				</DialogDescription>
			</DialogHeader>

			{detail.isPending ? (
				<div className="flex flex-col gap-3">
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-16 w-full" />
					<Skeleton className="h-16 w-full" />
				</div>
			) : detail.isError || !detail.data || !viewer ? (
				<div
					role="alert"
					className="flex flex-col items-start gap-3 border border-danger bg-danger-bg p-4"
				>
					<p className="text-sm text-danger">
						{detail.error instanceof Error
							? detail.error.message
							: "Could not load the project members."}
					</p>
					<Button
						variant="outline"
						onPress={() => {
							void detail.refetch();
						}}
					>
						<RefreshCwIcon aria-hidden />
						Try again
					</Button>
				</div>
			) : (
				<div className="flex flex-col gap-4">
					{viewer.canManageMembers && (
						<div className="flex flex-col gap-3 border border-app-border bg-app-panel-subtle p-3">
							<div className="flex flex-wrap items-center justify-between gap-2">
								<p className="text-xs font-semibold tracking-widest text-app-text-muted uppercase">
									Add organization members
								</p>
								<p aria-live="polite" className="text-xs text-app-text-muted">
									{selectedUserIds.size} selected
								</p>
							</div>

							<MultiSelect
								label="People to add"
								options={available.map((member) => ({
									value: member.userId,
									label: member.name,
									description: member.email,
									leading: (
										<UserAvatar
											size="sm"
											name={member.name}
											src={member.image}
										/>
									),
								}))}
								selected={[...selectedUserIds]}
								onSelectedChange={(next) => setSelectedUserIds(new Set(next))}
								placeholder="Select people to add"
								searchPlaceholder="Search name or email"
								emptyMessage="No people match."
								disabled={addMember.isPending}
							/>

							<div className="flex flex-wrap items-end gap-2">
								<div className="flex min-w-0 flex-1 flex-col gap-1">
									<span className="text-xs text-app-text-muted">
										Role for everyone selected
									</span>
									<Select
										aria-label="Project role for the new members"
										selectedKey={addRole}
										onSelectionChange={(key) => {
											if (isProjectRole(String(key))) {
												setAddRole(String(key) as ProjectRole);
											}
										}}
										isDisabled={addMember.isPending}
										className="w-full"
									>
										<SelectTrigger size="sm" className="w-full">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{roleOptions.map((role) => (
												<SelectItem key={role} id={role}>
													{PROJECT_ROLE_LABELS[role]}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>

								<Button
									onPress={handleAdd}
									loading={addMember.isPending}
									isDisabled={selectedUserIds.size === 0}
								>
									<UserPlusIcon data-icon="inline-start" />
									{selectedUserIds.size > 1
										? `Add ${selectedUserIds.size}`
										: "Add"}
								</Button>
							</div>
						</div>
					)}

					{results && (
						<BulkResultList
							results={results}
							label="People added to this project"
						/>
					)}

					<div className="border border-app-border">
						<div className="flex flex-wrap items-center justify-between gap-2 border-b border-app-border bg-app-panel-subtle px-3 py-2">
							<p className="text-xs font-semibold tracking-widest text-app-text-muted uppercase">
								On this project
							</p>
							<div className="flex flex-wrap items-center gap-2">
								{removableMembers.length > 0 && (
									<Button
										size="sm"
										variant="outline"
										onPress={toggleAllRemovable}
										isDisabled={removeMembers.isPending}
										aria-pressed={allRemovableSelected}
									>
										{allRemovableSelected ? "Clear selection" : "Select all"}
									</Button>
								)}

								{selectedMembers.length > 0 && (
									<Button
										size="sm"
										variant="destructive"
										onPress={() => {
											setError(null);
											setRemoveResults(null);
											setRemoveTargets(selectedMembers);
										}}
									>
										<Trash2Icon aria-hidden />
										Remove {selectedMembers.length}
									</Button>
								)}
							</div>
						</div>

						<div className="max-h-80 overflow-y-auto">
							{members.length === 0 ? (
								<p className="px-3 py-6 text-center text-sm text-app-text-muted">
									This project has no members besides the organization owners.
								</p>
							) : (
								<ul className="divide-y divide-app-border">
									{members.map((member) => {
										const locked = member.isOrganizationOwner || member.isSelf;
										const canChange =
											viewer.canManageMembers &&
											!locked &&
											canManageProjectTarget(viewer.projectRole, member.role);
										const selected = selectedMemberIds.has(member.userId);

										return (
											<li
												key={member.userId}
												className={`flex flex-wrap items-center gap-3 px-3 py-2.5${
													selected ? " bg-app-selected" : ""
												}`}
											>
												{canChange ? (
													<Checkbox
														isSelected={selected}
														onChange={() => toggleMemberSelected(member.userId)}
														isDisabled={removeMembers.isPending}
														aria-label={`Select ${member.name} for removal`}
														className="shrink-0"
													/>
												) : (
													// Keep the avatar aligned on rows that cannot be
													// selected, such as yourself and organization owners.
													<span className="size-4.5 shrink-0" aria-hidden />
												)}

												<UserAvatar
													size="sm"
													name={member.name}
													src={member.image}
												/>
												<div className="flex min-w-0 flex-1 flex-col">
													<span className="flex items-center gap-2 truncate font-medium text-app-text">
														{member.name}
														{member.isSelf && (
															<span className="text-xs text-app-text-muted">
																(you)
															</span>
														)}
													</span>
													<span className="truncate text-xs text-app-text-muted">
														{member.email}
													</span>
												</div>

												{member.isOrganizationOwner && (
													<span className="text-xs text-app-text-muted">
														Organization owner
													</span>
												)}

												{canChange ? (
													<Select
														aria-label={`Role for ${member.name}`}
														selectedKey={member.role}
														onSelectionChange={(key) => {
															if (
																isProjectRole(String(key)) &&
																String(key) !== member.role
															) {
																void handleRoleChange(
																	member,
																	String(key) as ProjectRole,
																);
															}
														}}
														isDisabled={updateRole.isPending}
													>
														<SelectTrigger size="sm" className="w-32">
															<SelectValue />
														</SelectTrigger>
														<SelectContent>
															{roleOptions.map((role) => (
																<SelectItem key={role} id={role}>
																	{PROJECT_ROLE_LABELS[role]}
																</SelectItem>
															))}
														</SelectContent>
													</Select>
												) : (
													<ProjectRoleChip role={member.role} />
												)}

												{canChange && (
													<Button
														variant="ghost"
														size="icon-sm"
														aria-label={`Remove ${member.name} from this project`}
														isDisabled={removeMembers.isPending}
														onPress={() => {
															setError(null);
															setRemoveResults(null);
															setRemoveTargets([member]);
														}}
													>
														<Trash2Icon aria-hidden />
													</Button>
												)}
											</li>
										);
									})}
								</ul>
							)}
						</div>
					</div>

					{removeResults && (
						<BulkResultList
							results={removeResults}
							label="Members removed from this project"
						/>
					)}

					{removeTargets.length > 0 && (
						<div
							role="alert"
							className="flex flex-wrap items-center justify-between gap-3 border border-danger bg-danger-bg px-3 py-2"
						>
							<div className="flex min-w-0 flex-col gap-0.5">
								<p className="text-sm text-danger">
									{removeTargets.length === 1
										? `Remove ${removeTargets[0]?.name ?? "this member"} from this project?`
										: `Remove ${removeTargets.length} members from this project?`}
								</p>
								{removeTargets.length > 1 && (
									<p className="text-xs text-danger">
										{removeTargets
											.slice(0, 4)
											.map((member) => member.name)
											.join(", ")}
										{removeTargets.length > 4
											? ` and ${removeTargets.length - 4} more`
											: ""}
									</p>
								)}
							</div>
							<div className="flex items-center gap-2">
								<Button
									variant="outline"
									size="sm"
									onPress={() => setRemoveTargets([])}
									isDisabled={removeMembers.isPending}
								>
									Cancel
								</Button>
								<Button
									variant="outline"
									size="sm"
									className="text-danger hover:bg-danger-bg hover:text-danger"
									loading={removeMembers.isPending}
									onPress={handleRemove}
								>
									Remove
								</Button>
							</div>
						</div>
					)}

					{error && (
						<p role="alert" className="text-sm text-danger">
							{error}
						</p>
					)}

					{!viewer.canManageMembers && (
						<p className="border border-app-border bg-app-panel-subtle p-3 text-sm text-app-text-muted">
							Only project owners and admins can change the member list.
						</p>
					)}
				</div>
			)}

			<DialogFooter>
				<Button variant="outline" onPress={() => onOpenChange(false)}>
					Close
				</Button>
			</DialogFooter>
		</Dialog>
	);
}
