/**
 * Project members dialog.
 *
 * Why one dialog: adding people, changing a role and removing someone all act
 * on the same list, so they share one fetch and one invalidation. The picker
 * is fed by the workspace member query, because a project member must already
 * belong to the organization.
 *
 * Organization owner rows are locked: the API treats them as project owners
 * unconditionally, so offering a role select or a remove button would promise
 * something it cannot do.
 *
 * Used by: routes/_app/$orgSlug.projects.tsx.
 */

import { Button } from "@org/ui/components/button";
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@org/ui/components/dialog";
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

import { UserAvatar } from "#/components/user-avatar";
import { useMembers } from "#/features/members/hooks";
import type { ProjectMemberRow, ProjectRow } from "./api";
import {
	useAddProjectMember,
	useProjectDetail,
	useRemoveProjectMember,
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

	const addMember = useAddProjectMember(orgSlug, projectId);
	const updateRole = useUpdateProjectMemberRole(orgSlug, projectId);
	const removeMember = useRemoveProjectMember(orgSlug, projectId);

	const [addUserId, setAddUserId] = useState<string | null>(null);
	const [addRole, setAddRole] = useState<ProjectRole>("member");
	const [removing, setRemoving] = useState<ProjectMemberRow | null>(null);
	const [error, setError] = useState<string | null>(null);

	// Reset the add form and any pending inline confirmation on close, so
	// reopening the dialog never shows a stale selection.
	useEffect(() => {
		if (isOpen) return;
		setAddUserId(null);
		setAddRole("member");
		setRemoving(null);
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
	const selectedMember =
		available.find((member) => member.userId === addUserId) ?? null;

	async function handleAdd() {
		if (!addUserId) return;

		setError(null);

		try {
			await addMember.mutateAsync({ userId: addUserId, role: addRole });
			toast.success("Member added to the project.");
			setAddUserId(null);
			setAddRole("member");
		} catch (addError) {
			setError(
				addError instanceof Error
					? addError.message
					: "Could not add that person.",
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
		if (!removing) return;

		setError(null);

		try {
			await removeMember.mutateAsync(removing.userId);
			toast.success(`${removing.name} was removed from the project.`);
			setRemoving(null);
		} catch (removeError) {
			setError(
				removeError instanceof Error
					? removeError.message
					: "Could not remove that person.",
			);
		}
	}

	return (
		<Dialog
			isOpen={isOpen}
			onOpenChange={onOpenChange}
			className="sm:max-w-2xl"
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
						<div className="flex flex-col gap-2 border border-app-border bg-app-panel-subtle p-3">
							<p className="text-xs font-semibold tracking-widest text-app-text-muted uppercase">
								Add an organization member
							</p>
							<div className="flex flex-wrap items-end gap-2">
								<div className="min-w-0 flex-1">
									<Select
										aria-label="Choose an organization member"
										placeholder="Select a person"
										selectedKey={addUserId}
										onSelectionChange={(key) => {
											setAddUserId(key === null ? null : String(key));
										}}
										isDisabled={addMember.isPending}
										className="w-full"
									>
										<SelectTrigger className="w-full">
											<SelectValue>
												{() =>
													selectedMember ? (
														<span className="flex min-w-0 items-center gap-2">
															<UserAvatar
																size="sm"
																name={selectedMember.name}
																src={selectedMember.image}
															/>
															<span className="truncate">
																{selectedMember.name}
															</span>
														</span>
													) : (
														<span className="text-muted-foreground">
															Select a person
														</span>
													)
												}
											</SelectValue>
										</SelectTrigger>
										<SelectContent>
											{available.length === 0 ? (
												<SelectItem id="none" isDisabled>
													Everyone is already on this project
												</SelectItem>
											) : (
												available.map((member) => (
													<SelectItem
														key={member.userId}
														id={member.userId}
														textValue={`${member.name} (${member.email})`}
													>
														<span className="flex min-w-0 flex-1 items-center gap-2">
															<UserAvatar
																size="sm"
																name={member.name}
																src={member.image}
															/>
															<span className="flex min-w-0 flex-col text-left">
																<span className="truncate font-medium">
																	{member.name}
																</span>
																<span className="truncate text-xs text-muted-foreground">
																	{member.email}
																</span>
															</span>
														</span>
													</SelectItem>
												))
											)}
										</SelectContent>
									</Select>
								</div>

								<Select
									aria-label="Project role for the new member"
									selectedKey={addRole}
									onSelectionChange={(key) => {
										if (isProjectRole(String(key))) {
											setAddRole(String(key) as ProjectRole);
										}
									}}
									isDisabled={addMember.isPending}
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

								<Button
									onPress={handleAdd}
									loading={addMember.isPending}
									isDisabled={!addUserId}
								>
									<UserPlusIcon data-icon="inline-start" />
									Add
								</Button>
							</div>
						</div>
					)}

					<div className="max-h-80 overflow-y-auto border border-app-border">
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

									return (
										<li
											key={member.userId}
											className="flex flex-wrap items-center gap-3 px-3 py-2.5"
										>
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
													isDisabled={removeMember.isPending}
													onPress={() => {
														setError(null);
														setRemoving(member);
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

					{removing && (
						<div
							role="alert"
							className="flex flex-wrap items-center justify-between gap-3 border border-danger bg-danger-bg px-3 py-2"
						>
							<p className="text-sm text-danger">
								Remove {removing.name} from this project?
							</p>
							<div className="flex items-center gap-2">
								<Button
									variant="outline"
									size="sm"
									onPress={() => setRemoving(null)}
									isDisabled={removeMember.isPending}
								>
									Cancel
								</Button>
								<Button
									variant="outline"
									size="sm"
									className="text-danger hover:bg-danger-bg hover:text-danger"
									loading={removeMember.isPending}
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
