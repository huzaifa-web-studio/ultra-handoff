/**
 * Project members table.
 *
 * Why react-aria primitives: they give the table, row, sorting and selection
 * semantics for free, and the project page already renders its selection the
 * same way. The table is small, so filtering and sorting run locally.
 *
 * Rules mirror the API: an organization owner row is always a project owner and
 * cannot be removed, you cannot remove yourself, and you can only manage people
 * below your project role. Locked rows show a lock instead of a checkbox.
 *
 * Used by: project-members-page.tsx.
 */

import { Button } from "@org/ui/components/button";
import { Checkbox } from "@org/ui/components/checkbox";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@org/ui/components/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@org/ui/components/table";
import { LockIcon, Trash2Icon } from "lucide-react";
import type { Selection, SortDescriptor } from "react-aria-components";

import { SortIndicator } from "#/components/data-table/sort-indicator";
import { UserAvatar } from "#/components/user-avatar";
import { formatDate, formatDateTime } from "#/lib/date";
import type { ProjectMemberRow, ProjectViewer } from "../api";
import {
	canManageProjectTarget,
	isProjectRole,
	PROJECT_ROLE_LABELS,
	type ProjectRole,
} from "../permissions";
import { ProjectRoleChip } from "../project-role-chip";

/** The only columns the table can sort by. */
export type ProjectMemberSort = {
	column: "name" | "added";
	direction: "asc" | "desc";
};

export function ProjectMembersTable({
	members,
	viewer,
	selected,
	onSelectedChange,
	onRoleChange,
	onRemove,
	isUpdatingRole,
	sort,
	onSortChange,
	emptyMessage,
}: {
	members: ProjectMemberRow[];
	viewer: ProjectViewer;
	selected: Set<string>;
	onSelectedChange: (next: Set<string>) => void;
	onRoleChange: (member: ProjectMemberRow, role: ProjectRole) => void;
	onRemove: (member: ProjectMemberRow) => void;
	isUpdatingRole: boolean;
	sort: ProjectMemberSort;
	onSortChange: (next: ProjectMemberSort) => void;
	emptyMessage: string;
}) {
	const canManage = viewer.canManageMembers;

	const canChange = (member: ProjectMemberRow) =>
		canManage &&
		!member.isOrganizationOwner &&
		!member.isSelf &&
		canManageProjectTarget(viewer.projectRole, member.role);

	const removableIds = members
		.filter((member) => canChange(member))
		.map((member) => member.userId);
	const removable = new Set(removableIds);

	function handleSelectionChange(keys: Selection) {
		if (keys === "all") {
			onSelectedChange(new Set(removableIds));
			return;
		}

		onSelectedChange(
			new Set(
				Array.from(keys)
					.map(String)
					.filter((userId) => removable.has(userId)),
			),
		);
	}

	const sortDescriptor: SortDescriptor = {
		column: sort.column,
		direction: sort.direction === "asc" ? "ascending" : "descending",
	};

	return (
		<Table
			aria-label="Project members"
			selectionMode={canManage ? "multiple" : "none"}
			selectedKeys={selected}
			onSelectionChange={handleSelectionChange}
			disabledKeys={members
				.filter((member) => !removable.has(member.userId))
				.map((member) => member.userId)}
			sortDescriptor={sortDescriptor}
			onSortChange={(descriptor) => {
				const column = String(descriptor.column);

				if (column !== "name" && column !== "added") return;

				onSortChange({
					column,
					direction: descriptor.direction === "descending" ? "desc" : "asc",
				});
			}}
		>
			<TableHeader>
				{canManage && (
					<TableHead className="w-10">
						<Checkbox
							slot="selection"
							aria-label="Select every removable member"
						/>
					</TableHead>
				)}
				<TableHead
					id="name"
					isRowHeader
					allowsSorting
					className="cursor-pointer"
				>
					<span className="inline-flex items-center gap-1.5">
						Member
						<SortIndicator
							direction={sort.column === "name" ? sort.direction : false}
						/>
					</span>
				</TableHead>
				<TableHead>Role</TableHead>
				<TableHead id="added" allowsSorting className="cursor-pointer">
					<span className="inline-flex items-center gap-1.5">
						Added
						<SortIndicator
							direction={sort.column === "added" ? sort.direction : false}
						/>
					</span>
				</TableHead>
				<TableHead>
					<span className="sr-only">Actions</span>
				</TableHead>
			</TableHeader>

			<TableBody
				renderEmptyState={() => (
					<div className="px-3 py-10 text-center text-sm text-app-text-muted">
						{emptyMessage}
					</div>
				)}
			>
				{members.map((member) => {
					const changeable = canChange(member);

					return (
						<TableRow key={member.userId} id={member.userId}>
							{canManage && (
								<TableCell>
									{removable.has(member.userId) ? (
										<Checkbox
											slot="selection"
											aria-label={`Select ${member.name}`}
										/>
									) : (
										<span
											className="flex size-4 items-center justify-center"
											title="You cannot remove this member"
										>
											<LockIcon
												className="size-3.5 text-app-text-muted"
												aria-hidden
											/>
											<span className="sr-only">Cannot be selected</span>
										</span>
									)}
								</TableCell>
							)}

							<TableCell>
								<div className="flex min-w-0 items-center gap-2.5">
									<UserAvatar size="sm" name={member.name} src={member.image} />
									<div className="flex min-w-0 flex-col">
										<span className="flex items-center gap-1.5 truncate font-medium text-app-text">
											{member.name}
											{member.isSelf && (
												<span className="text-xs font-normal text-app-text-muted">
													(you)
												</span>
											)}
										</span>
										<span className="truncate text-xs text-app-text-muted">
											{member.email}
										</span>
									</div>
								</div>
							</TableCell>

							<TableCell>
								{changeable ? (
									<Select
										aria-label={`Role for ${member.name}`}
										selectedKey={member.role}
										onSelectionChange={(key) => {
											if (
												isProjectRole(String(key)) &&
												String(key) !== member.role
											) {
												onRoleChange(member, String(key) as ProjectRole);
											}
										}}
										isDisabled={isUpdatingRole}
									>
										<SelectTrigger size="sm" className="w-32">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{viewer.assignableRoles.map((role) => (
												<SelectItem key={role} id={role}>
													{PROJECT_ROLE_LABELS[role]}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								) : (
									<div className="flex flex-wrap items-center gap-2">
										<ProjectRoleChip role={member.role} />
										{member.isOrganizationOwner && (
											<span className="text-xs text-app-text-muted">
												Organization owner
											</span>
										)}
									</div>
								)}
							</TableCell>

							<TableCell>
								<span
									className="text-sm text-app-text-muted"
									title={formatDateTime(member.addedAt)}
								>
									{formatDate(member.addedAt)}
								</span>
							</TableCell>

							<TableCell>
								{changeable && (
									<div className="flex justify-end">
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label={`Remove ${member.name} from this project`}
											onPress={() => onRemove(member)}
										>
											<Trash2Icon aria-hidden />
										</Button>
									</div>
								)}
							</TableCell>
						</TableRow>
					);
				})}
			</TableBody>
		</Table>
	);
}
