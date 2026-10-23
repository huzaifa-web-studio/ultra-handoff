/**
 * Project members settings page.
 *
 * Why a page component: it owns the search, the selection and the two dialogs,
 * while the table and toolbar stay presentational. Role changes go straight to
 * the API; removal goes through a confirmation that names everyone affected.
 *
 * Used by: routes/_app/$orgSlug.projects.$projectSlug.settings.members.tsx.
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";

import type { ProjectMemberRow } from "../api";
import { useProjectDetailBySlug, useUpdateProjectMemberRole } from "../hooks";
import { PROJECT_ROLE_LABELS, type ProjectRole } from "../permissions";
import { ProjectErrorState } from "../project-error-state";
import { ProjectRoleChip } from "../project-role-chip";
import { ProjectAddMembersDialog } from "./project-add-members-dialog";
import {
	type ProjectMemberSort,
	ProjectMembersTable,
} from "./project-members-table";
import { ProjectMembersToolbar } from "./project-members-toolbar";
import { ProjectRemoveMembersDialog } from "./project-remove-members-dialog";
import { ProjectSettingsSkeleton } from "./project-settings-skeleton";

export function ProjectMembersPage({
	orgSlug,
	projectSlug,
}: {
	orgSlug: string;
	projectSlug: string;
}) {
	const query = useProjectDetailBySlug(orgSlug, projectSlug);

	// The mutation hook needs an id at all times, so it gets an empty string
	// while the query resolves. Nothing invokes it before the page renders.
	const projectId = query.data?.project.id ?? "";
	const updateRole = useUpdateProjectMemberRole(orgSlug, projectId);

	const [search, setSearch] = useState("");
	const [roleFilter, setRoleFilter] = useState<"all" | ProjectRole>("all");
	const [sort, setSort] = useState<ProjectMemberSort>({
		column: "name",
		direction: "asc",
	});
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [addOpen, setAddOpen] = useState(false);
	const [removeTargets, setRemoveTargets] = useState<ProjectMemberRow[]>([]);

	// A hidden row must never stay selected behind a filter.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset on filter change
	useEffect(() => {
		setSelected(new Set());
	}, [search, roleFilter]);

	if (query.isPending) {
		return <ProjectSettingsSkeleton />;
	}

	if (query.isError && !query.data) {
		return (
			<ProjectErrorState
				message={
					query.error instanceof Error
						? query.error.message
						: "Could not load the project."
				}
				onRetry={() => {
					void query.refetch();
				}}
				orgSlug={orgSlug}
			/>
		);
	}

	if (!query.data) return null;

	const { project, members, viewer } = query.data;
	const canManage = viewer.canManageMembers;

	const normalizedSearch = search.trim().toLowerCase();
	const filtered = members.filter((member) => {
		const matchesSearch =
			normalizedSearch.length === 0 ||
			`${member.name} ${member.email}`.toLowerCase().includes(normalizedSearch);
		const matchesRole = roleFilter === "all" || member.role === roleFilter;

		return matchesSearch && matchesRole;
	});

	// Name and added are the only sortable columns. Name uses a locale compare so
	// accented names stay in a sensible order, and added compares timestamps.
	const direction = sort.direction === "asc" ? 1 : -1;
	const sorted = [...filtered].sort((a, b) => {
		const comparison =
			sort.column === "name"
				? a.name.localeCompare(b.name)
				: new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime();

		return comparison * direction;
	});

	const selectedMembers = sorted.filter((member) =>
		selected.has(member.userId),
	);

	async function handleRoleChange(member: ProjectMemberRow, role: ProjectRole) {
		try {
			await updateRole.mutateAsync({ userId: member.userId, role });
			toast.success(`${member.name} is now ${PROJECT_ROLE_LABELS[role]}.`);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Could not change that role.",
			);
		}
	}

	return (
		<div className="flex w-full flex-col gap-6">
			<header className="flex flex-col gap-2">
				<div className="flex flex-wrap items-center gap-3">
					<h1 className="text-2xl font-bold text-app-text">Members</h1>
					<ProjectRoleChip role={viewer.projectRole} />
				</div>
				<p className="text-app-text-muted">
					People who can open this project and the role they hold.
				</p>
			</header>

			<ProjectMembersToolbar
				search={search}
				onSearchChange={setSearch}
				roleFilter={roleFilter}
				onRoleFilterChange={setRoleFilter}
				total={members.length}
				visibleCount={sorted.length}
				selectedCount={selectedMembers.length}
				canManage={canManage}
				onAdd={() => setAddOpen(true)}
				onRemoveSelected={() => setRemoveTargets(selectedMembers)}
			/>

			<section className="border border-app-border bg-app-panel">
				<ProjectMembersTable
					members={sorted}
					viewer={viewer}
					selected={selected}
					onSelectedChange={setSelected}
					onRoleChange={(member, role) => {
						void handleRoleChange(member, role);
					}}
					onRemove={(member) => setRemoveTargets([member])}
					isUpdatingRole={updateRole.isPending}
					sort={sort}
					onSortChange={setSort}
					emptyMessage={
						normalizedSearch.length > 0 || roleFilter !== "all"
							? "No members match your filters."
							: "No members yet."
					}
				/>
			</section>

			{canManage && (
				<ProjectAddMembersDialog
					orgSlug={orgSlug}
					projectId={project.id}
					projectName={project.name}
					existingUserIds={new Set(members.map((member) => member.userId))}
					assignableRoles={viewer.assignableRoles}
					isOpen={addOpen}
					onOpenChange={setAddOpen}
				/>
			)}

			<ProjectRemoveMembersDialog
				orgSlug={orgSlug}
				projectId={project.id}
				members={removeTargets}
				isOpen={removeTargets.length > 0}
				onOpenChange={(open) => {
					if (!open) setRemoveTargets([]);
				}}
				onRemoved={() => setSelected(new Set())}
			/>
		</div>
	);
}
