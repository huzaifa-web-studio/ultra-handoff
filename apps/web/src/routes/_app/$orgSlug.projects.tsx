/**
 * Projects page.
 *
 * Why one page component: the table, toolbar, create/edit dialog, members
 * dialog and delete confirmation all operate on the same list, so they share
 * the search, filter, sort and pagination state here. The API owns every
 * permission check; the UI only hides actions the caller cannot perform.
 *
 * Used by: the app sidebar at `/$orgSlug/projects`.
 */

import { Button } from "@org/ui/components/button";
import { Skeleton } from "@org/ui/components/skeleton";
import { createFileRoute } from "@tanstack/react-router";
import type { SortingState } from "@tanstack/react-table";
import { PlusIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { TableLoader } from "#/components/data-table/table-loader";
import { TablePagination } from "#/components/data-table/table-pagination";
import { RoleChip } from "#/components/role-chip";
import type { ProjectListFilters, ProjectRow } from "#/features/projects/api";
import { ArchiveProjectDialog } from "#/features/projects/archive-project-dialog";
import { DeleteProjectDialog } from "#/features/projects/delete-project-dialog";
import { useProjects } from "#/features/projects/hooks";
import { ProjectDialog } from "#/features/projects/project-dialog";
import { ProjectMembersDialog } from "#/features/projects/project-members-dialog";
import { ProjectsTable } from "#/features/projects/projects-table";
import { ProjectsToolbar } from "#/features/projects/projects-toolbar";
import { useDebouncedValue } from "#/hooks/use-debounced-value";

export const Route = createFileRoute("/_app/$orgSlug/projects")({
	component: ProjectsPage,
	staticData: { breadcrumb: "Projects" },
});

type StatusFilter = "all" | "active" | "archived";
type SortField = "name" | "createdAt" | "updatedAt";

const DEFAULT_SORTING: SortingState = [{ id: "updatedAt", desc: true }];

function ProjectsPage() {
	const { orgSlug } = Route.useParams();

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

	// A filter change always returns to the first page. Otherwise the user
	// could land on a page that does not exist for the new filter.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset on filter change
	useEffect(() => {
		setPagination((prev) => ({ ...prev, pageIndex: 0 }));
	}, [debouncedSearch, status]);

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

	if (projectsQuery.isPending) {
		return <ProjectsSkeleton />;
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
					variant="outline"
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

			<div className="grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-3">
				<SummaryStat label="Active" value={String(counts.active)} />
				<SummaryStat label="Archived" value={String(counts.archived)} />
				<SummaryStat label="Total" value={String(counts.all)} />
			</div>

			<div className="shrink-0">
				<ProjectsToolbar
					search={search}
					onSearchChange={setSearch}
					status={status}
					onStatusChange={setStatus}
					visibleCount={data.total}
					totalCount={counts.all}
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
						onEdit={handleEdit}
						onManageMembers={handleManageMembers}
						onArchive={handleArchive}
						onUnarchive={handleUnarchive}
						onDelete={handleDelete}
						emptyState={
							<ProjectsEmptyState
								hasProjects={counts.all > 0}
								hasArchived={counts.archived > 0}
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
		</div>
	);
}

/** One number in the summary strip. */
function SummaryStat({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex flex-col gap-1 border border-app-border bg-app-panel p-3">
			<span className="text-xs font-semibold tracking-widest text-app-text-muted uppercase">
				{label}
			</span>
			<span className="text-lg font-bold text-app-text">{value}</span>
		</div>
	);
}

/** Role aware empty state, so nobody is told to do something they cannot. */
function ProjectsEmptyState({
	hasProjects,
	hasArchived,
	status,
	canCreate,
	onCreate,
	onClear,
}: {
	hasProjects: boolean;
	hasArchived: boolean;
	status: StatusFilter;
	canCreate: boolean;
	onCreate: () => void;
	onClear: () => void;
}) {
	if (!hasProjects) {
		return (
			<div className="flex flex-col items-center gap-3 px-3 py-10 text-center">
				<p className="text-sm text-app-text-muted">
					{canCreate
						? "No projects yet. Create the first one for this organization."
						: "You are not a member of any project yet. An organization owner or admin can add you."}
				</p>
				{canCreate && (
					<Button variant="outline" onPress={onCreate}>
						<PlusIcon aria-hidden />
						Create your first project
					</Button>
				)}
			</div>
		);
	}

	if (status === "archived" && !hasArchived) {
		return (
			<div className="px-3 py-10 text-center text-sm text-app-text-muted">
				No archived projects.
			</div>
		);
	}

	return (
		<div className="flex flex-col items-center gap-3 px-3 py-10 text-center">
			<p className="text-sm text-app-text-muted">
				No projects match your filters.
			</p>
			<Button variant="outline" onPress={onClear}>
				Clear filters
			</Button>
		</div>
	);
}

/** Loading shape that matches the real page, so it does not jump. */
function ProjectsSkeleton() {
	return (
		<div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
			<div className="flex flex-col gap-2">
				<Skeleton className="h-8 w-40" />
				<Skeleton className="h-4 w-96" />
			</div>
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
				<Skeleton className="h-20 w-full" />
				<Skeleton className="h-20 w-full" />
				<Skeleton className="h-20 w-full" />
			</div>
			<Skeleton className="h-12 w-full" />
			<Skeleton className="h-80 w-full" />
		</div>
	);
}
