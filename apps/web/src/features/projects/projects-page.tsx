/**
 * Projects page.
 *
 * Why this lives in the feature: the route file only resolves the workspace
 * slug and renders this component. The table, toolbar, dialogs and bulk actions
 * share search, filter, sort, pagination and selection state, so they are
 * orchestrated here. The API owns every permission check; the UI only hides
 * actions the caller cannot perform.
 *
 * Used by: routes/_app/$orgSlug.projects.index.tsx.
 */

import { Button } from "@org/ui/components/button";
import { useNavigate } from "@tanstack/react-router";
import type { SortingState } from "@tanstack/react-table";
import { PlusIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { TableLoader } from "#/components/data-table/table-loader";
import { TablePagination } from "#/components/data-table/table-pagination";
import { RoleChip } from "#/components/role-chip";
import { beginOrganizationOperation } from "#/features/organization/switch-guard";
import { useDebouncedValue } from "#/hooks/use-debounced-value";
import type { ProjectListFilters, ProjectRow } from "./api";
import { ArchiveProjectDialog } from "./archive-project-dialog";
import { BulkDeleteProjectsDialog } from "./bulk-delete-projects-dialog";
import { DeleteProjectDialog } from "./delete-project-dialog";
import {
	useBulkArchiveProjects,
	useBulkUnarchiveProjects,
	useProjects,
	useSetProjectPinned,
} from "./hooks";
import { ProjectDialog } from "./project-dialog";
import { ProjectMembersDialog } from "./project-members-dialog";
import { ProjectsEmptyState } from "./projects-empty-state";
import { ProjectsPageSkeleton } from "./projects-page-skeleton";
import { ProjectsSummary } from "./projects-summary";
import { ProjectsTable } from "./projects-table";
import { ProjectsToolbar } from "./projects-toolbar";

type StatusFilter = "all" | "active" | "archived";
type SortField = "name" | "createdAt" | "updatedAt";

const DEFAULT_SORTING: SortingState = [{ id: "updatedAt", desc: true }];

export function ProjectsPage({ orgSlug }: { orgSlug: string }) {
	const [search, setSearch] = useState("");
	const debouncedSearch = useDebouncedValue(search, 300);
	const [status, setStatus] = useState<StatusFilter>("active");
	const [sorting, setSorting] = useState<SortingState>(DEFAULT_SORTING);
	const [pagination, setPagination] = useState({
		pageIndex: 0,
		pageSize: 20,
	});

	const [createOpen, setCreateOpen] = useState(false);
	const [editTarget, setEditTarget] = useState<ProjectRow | null>(null);
	const [membersTarget, setMembersTarget] = useState<ProjectRow | null>(null);
	const [archiveTarget, setArchiveTarget] = useState<{
		project: ProjectRow;
		mode: "archive" | "unarchive";
	} | null>(null);
	const [deleteTarget, setDeleteTarget] = useState<ProjectRow | null>(null);
	/** Ids ticked in the table for a bulk action. Page scoped. */
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

	const bulkArchive = useBulkArchiveProjects(orgSlug);
	const bulkUnarchive = useBulkUnarchiveProjects(orgSlug);
	const { mutate: setPinned } = useSetProjectPinned(orgSlug);

	const navigate = useNavigate();

	// The table column id for the name is "project". Everything else maps
	// straight to an API sort field.
	const sortField: SortField =
		sorting[0]?.id === "project"
			? "name"
			: sorting[0]?.id === "updatedAt"
				? "updatedAt"
				: "createdAt";
	const sortDirection: "asc" | "desc" = sorting[0]?.desc ? "desc" : "asc";

	const filters: ProjectListFilters = {
		search: debouncedSearch,
		status,
		sort: sortField,
		direction: sortDirection,
		page: pagination.pageIndex + 1,
		pageSize: pagination.pageSize,
	};

	const projectsQuery = useProjects(orgSlug, filters);
	const data = projectsQuery.data;
	const canSeeArchived = data?.viewer.canSeeArchived ?? false;

	// A caller who cannot see archived projects must never sit on an Archived
	// filter that can only return nothing, for example after a role change.
	useEffect(() => {
		if (!canSeeArchived && status === "archived") setStatus("active");
	}, [canSeeArchived, status]);

	// A filter change always returns to the first page and drops the selection.
	// Otherwise the user could land on a page that does not exist for the new
	// filter, or act on rows they can no longer see.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset on filter change
	useEffect(() => {
		setSelected(new Set());
		setPagination((prev) => ({ ...prev, pageIndex: 0 }));
	}, [debouncedSearch, status]);

	// Selection is page scoped, because bulk actions only ever apply to rows
	// that are currently visible.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset on page change
	useEffect(() => {
		setSelected(new Set());
	}, [pagination.pageIndex, pagination.pageSize]);

	// A delete can shrink the list below the current page. Keep the state in
	// range instead of showing an empty page.
	const totalPages = data?.totalPages ?? 1;
	useEffect(() => {
		if (pagination.pageIndex > totalPages - 1) {
			setPagination((prev) => ({
				...prev,
				pageIndex: Math.max(0, totalPages - 1),
			}));
		}
	}, [pagination.pageIndex, totalPages]);

	const handleClearFilters = useCallback(() => {
		setSearch("");
		setStatus("active");
	}, []);

	const handleEdit = useCallback((project: ProjectRow) => {
		setEditTarget(project);
	}, []);

	const handleManageMembers = useCallback((project: ProjectRow) => {
		setMembersTarget(project);
	}, []);

	const handleArchive = useCallback((project: ProjectRow) => {
		setArchiveTarget({ project, mode: "archive" });
	}, []);

	const handleUnarchive = useCallback((project: ProjectRow) => {
		setArchiveTarget({ project, mode: "unarchive" });
	}, []);

	const handleDelete = useCallback((project: ProjectRow) => {
		setDeleteTarget(project);
	}, []);

	/**
	 * Open a project workspace.
	 *
	 * The sidebar lists every project already, so there is nothing to add here.
	 * This only navigates, and the slug keeps the URL readable.
	 */
	const handleOpen = useCallback(
		(project: ProjectRow) => {
			navigate({
				to: "/$orgSlug/projects/$projectSlug",
				params: { orgSlug, projectSlug: project.slug },
			});
		},
		[navigate, orgSlug],
	);

	/** Pin or unpin from the row menu, with a toast only on failure. */
	const handleTogglePin = useCallback(
		(project: ProjectRow) => {
			setPinned(
				{ projectId: project.id, pinned: !project.pinned },
				{
					onError: (error) => {
						toast.error(
							error instanceof Error
								? error.message
								: "Could not update the pin.",
						);
					},
				},
			);
		},
		[setPinned],
	);

	if (projectsQuery.isPending) {
		return <ProjectsPageSkeleton />;
	}

	if (projectsQuery.isError && !data) {
		return (
			<div
				role="alert"
				className="mx-auto flex w-full max-w-3xl flex-col items-start gap-3 border border-danger bg-danger-bg p-4"
			>
				<p className="text-sm text-danger">
					{projectsQuery.error instanceof Error
						? projectsQuery.error.message
						: "Could not load the projects."}
				</p>
				<Button
					variant="surface"
					onPress={() => {
						void projectsQuery.refetch();
					}}
				>
					<RefreshCwIcon aria-hidden />
					Try again
				</Button>
			</div>
		);
	}

	if (!data) return null;

	const { viewer, counts } = data;
	// Captured once so the handlers below do not need a repeated guard.
	const organizationId = data.organizationId;

	// Only rows on this page can be selected, so the selection resolves against
	// the rows the table is currently showing.
	const selectedProjects = data.projects.filter((project) =>
		selected.has(project.id),
	);
	const archivableProjects = selectedProjects.filter(
		(project) => project.canEdit && project.status === "active",
	);
	const restorableProjects = selectedProjects.filter(
		(project) => project.canEdit && project.status === "archived",
	);

	/**
	 * Archive or restore the selected projects.
	 *
	 * Both directions share this runner because the only differences are the
	 * mutation and the status name. Rows the caller cannot edit are filtered
	 * out before the request, so the batch only carries actionable ids.
	 */
	async function applyBulkArchive(
		projectsToChange: ProjectRow[],
		archived: boolean,
	) {
		if (projectsToChange.length === 0) return;
		if (bulkArchive.isPending || bulkUnarchive.isPending) return;

		const count = projectsToChange.length;
		const operation = beginOrganizationOperation({
			organizationId,
			organizationSlug: orgSlug,
			reason: `${archived ? "Archiving" : "Restoring"} ${count} project${
				count === 1 ? "" : "s"
			}`,
		});

		try {
			const projectIds = projectsToChange.map((project) => project.id);
			const result = archived
				? await bulkArchive.mutateAsync(projectIds)
				: await bulkUnarchive.mutateAsync(projectIds);

			const successStatus = archived ? "archived" : "restored";
			const done = result.results.filter(
				(item) => item.status === successStatus,
			).length;
			// Rows filtered out before the request count as skipped too, so the
			// summary matches what the user selected.
			const skipped =
				result.results.length - done + (selectedProjects.length - count);

			if (done > 0) {
				toast.success(
					`${done} project${done === 1 ? "" : "s"} ${
						archived ? "archived" : "restored"
					}.`,
				);
			}

			if (skipped > 0) {
				toast.warning(
					`${skipped} project${skipped === 1 ? "" : "s"} skipped.`,
					{
						description: `You can only ${
							archived ? "archive" : "restore"
						} projects you own or administer.`,
					},
				);
			}

			setSelected(new Set());
		} catch (error) {
			toast.error(
				error instanceof Error
					? error.message
					: archived
						? "Could not archive those projects."
						: "Could not restore those projects.",
			);
		} finally {
			operation.end();
		}
	}

	return (
		<div className="mx-auto flex w-full max-w-5xl flex-col gap-6 lg:h-full lg:min-h-0">
			<header className="flex shrink-0 flex-col gap-2">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div className="flex flex-wrap items-center gap-3">
						<h1 className="text-2xl font-bold text-app-text">Projects</h1>
						<RoleChip role={viewer.organizationRole} />
					</div>
					{viewer.canCreate && (
						<Button onPress={() => setCreateOpen(true)}>
							<PlusIcon data-icon="inline-start" />
							New project
						</Button>
					)}
				</div>
				<p className="text-app-text-muted">
					Every client engagement your team is delivering. You only see the
					projects you belong to.
				</p>
			</header>

			<ProjectsSummary counts={counts} canSeeArchived={canSeeArchived} />

			<div className="shrink-0">
				<ProjectsToolbar
					search={search}
					onSearchChange={setSearch}
					status={status}
					onStatusChange={setStatus}
					canSeeArchived={canSeeArchived}
					visibleCount={data.total}
					totalCount={counts.all}
					selectedCount={selectedProjects.length}
					onClearSelection={() => setSelected(new Set())}
					canArchive={archivableProjects.length > 0}
					canRestore={restorableProjects.length > 0}
					canDelete={selectedProjects.some((project) => project.canDelete)}
					onBulkArchive={() => {
						void applyBulkArchive(archivableProjects, true);
					}}
					onBulkRestore={() => {
						void applyBulkArchive(restorableProjects, false);
					}}
					onBulkDelete={() => setBulkDeleteOpen(true)}
					onRefresh={() => {
						void projectsQuery.refetch();
					}}
					isRefreshing={projectsQuery.isFetching}
				/>
			</div>

			{/*
			 * At lg the table fills exactly the height left after the header,
			 * summary and toolbar. Below lg it keeps a scrollable floor and cap.
			 */}
			<section className="relative flex flex-col border border-app-border bg-app-panel lg:min-h-0 lg:flex-1">
				<div
					className="min-h-[40dvh] max-h-[60dvh] overflow-auto lg:min-h-0 lg:max-h-none lg:flex-1"
					aria-busy={projectsQuery.isFetching}
				>
					<ProjectsTable
						projects={data.projects}
						sorting={sorting}
						onSortingChange={setSorting}
						selected={selected}
						onSelectedChange={setSelected}
						onEdit={handleEdit}
						onManageMembers={handleManageMembers}
						onArchive={handleArchive}
						onUnarchive={handleUnarchive}
						onDelete={handleDelete}
						onOpen={handleOpen}
						onTogglePin={handleTogglePin}
						emptyState={
							<ProjectsEmptyState
								hasProjects={counts.all > 0}
								hasArchived={canSeeArchived && counts.archived > 0}
								status={status}
								canCreate={viewer.canCreate}
								onCreate={() => setCreateOpen(true)}
								onClear={handleClearFilters}
							/>
						}
					/>
				</div>

				<div className="shrink-0 border-t border-app-border p-3">
					<TablePagination
						page={data.page}
						pageSize={pagination.pageSize}
						total={data.total}
						totalPages={data.totalPages}
						hasNext={data.page < data.totalPages}
						hasPrevious={data.page > 1}
						onPageChange={(page) => {
							setPagination((prev) => ({ ...prev, pageIndex: page - 1 }));
						}}
						onPageSizeChange={(size) => {
							setPagination({ pageIndex: 0, pageSize: size });
						}}
					/>
				</div>

				{projectsQuery.isFetching && (
					<TableLoader label="Loading projects..." />
				)}
			</section>

			{/*
			 * Mount the create dialog only while it is open. Otherwise the
			 * component stays alive with the previous form values, and a new
			 * project dialog would briefly show the last name's avatar initials
			 * or the last uploaded logo. The edit dialog already works this way.
			 */}
			{createOpen && (
				<ProjectDialog
					orgSlug={orgSlug}
					organizationId={data.organizationId}
					mode="create"
					isOpen={createOpen}
					onOpenChange={setCreateOpen}
					onCreated={() => {
						// Reveal the new project even if the user was searching or
						// looking at archived projects when they created it.
						setSearch("");
						setStatus("active");
						setPagination((prev) => ({ ...prev, pageIndex: 0 }));
					}}
				/>
			)}

			{editTarget && (
				<ProjectDialog
					orgSlug={orgSlug}
					organizationId={data.organizationId}
					mode="edit"
					project={editTarget}
					isOpen={Boolean(editTarget)}
					onOpenChange={(open) => {
						if (!open) setEditTarget(null);
					}}
				/>
			)}

			<ProjectMembersDialog
				orgSlug={orgSlug}
				project={membersTarget}
				isOpen={Boolean(membersTarget)}
				onOpenChange={(open) => {
					if (!open) setMembersTarget(null);
				}}
			/>

			<ArchiveProjectDialog
				orgSlug={orgSlug}
				project={archiveTarget?.project ?? null}
				mode={archiveTarget?.mode ?? "archive"}
				isOpen={Boolean(archiveTarget)}
				onOpenChange={(open) => {
					if (!open) setArchiveTarget(null);
				}}
				onChanged={() => setArchiveTarget(null)}
			/>

			<DeleteProjectDialog
				orgSlug={orgSlug}
				project={deleteTarget}
				isOpen={Boolean(deleteTarget)}
				onOpenChange={(open) => {
					if (!open) setDeleteTarget(null);
				}}
				onDeleted={() => setDeleteTarget(null)}
			/>

			<BulkDeleteProjectsDialog
				organizationId={data.organizationId}
				orgSlug={orgSlug}
				isOpen={bulkDeleteOpen}
				onOpenChange={setBulkDeleteOpen}
				projects={selectedProjects}
				onDeleted={() => {
					setBulkDeleteOpen(false);
					setSelected(new Set());
				}}
			/>
		</div>
	);
}
