/**
 * Projects table.
 *
 * Why TanStack Table plus react-aria primitives: TanStack owns the column
 * model and the sort state, while react-aria renders the markup and keeps the
 * keyboard and screen reader semantics. Sorting is manual because the API sorts
 * and paginates the whole workspace, not just the loaded page.
 *
 * Used by: routes/_app/$orgSlug.projects.index.tsx.
 */

import { Button } from "@org/ui/components/button";
import { Checkbox } from "@org/ui/components/checkbox";
import {
	DropdownMenu,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@org/ui/components/dropdown-menu";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@org/ui/components/table";
import {
	type ColumnDef,
	flexRender,
	getCoreRowModel,
	type SortingState,
	useReactTable,
} from "@tanstack/react-table";
import {
	ArchiveIcon,
	ArchiveRestoreIcon,
	ArrowUpRightIcon,
	MoreHorizontalIcon,
	PencilIcon,
	PinIcon,
	PinOffIcon,
	Trash2Icon,
	UsersIcon,
} from "lucide-react";
import { useMemo } from "react";
import type { Selection, SortDescriptor } from "react-aria-components";
import { SortIndicator } from "#/components/data-table/sort-indicator";
import { UserAvatar } from "#/components/user-avatar";
import { formatDate, formatDateTime } from "#/lib/date";
import { BULK_SELECTION_MAX } from "#/lib/limits";
import type { ProjectRow } from "./api";
import { ProjectRoleChip } from "./project-role-chip";
import { ProjectStatusBadge } from "./project-status-badge";

type ProjectsTableProps = {
	projects: ProjectRow[];
	sorting: SortingState;
	onSortingChange: (next: SortingState) => void;
	/** Ids of the rows currently selected for a bulk action. */
	selected: Set<string>;
	onSelectedChange: (next: Set<string>) => void;
	onEdit: (project: ProjectRow) => void;
	onManageMembers: (project: ProjectRow) => void;
	onArchive: (project: ProjectRow) => void;
	onUnarchive: (project: ProjectRow) => void;
	onDelete: (project: ProjectRow) => void;
	/** Open the project workspace and add it to the sidebar. */
	onOpen: (project: ProjectRow) => void;
	/** Pin or unpin the project in the caller's own sidebar. */
	onTogglePin: (project: ProjectRow) => void;
	emptyState: React.ReactNode;
};

/**
 * The table scrolls inside its own card, so the header stays visible while the
 * rows move. The background must be opaque or rows show through.
 */
const STICKY_HEADER =
	"sticky top-0 z-10 border-b border-app-border bg-app-panel";

/** Row menu. Always present, because every row can be opened and pinned. */
function ProjectActions({
	project,
	onOpen,
	onTogglePin,
	onEdit,
	onManageMembers,
	onArchive,
	onUnarchive,
	onDelete,
}: {
	project: ProjectRow;
	onOpen: (project: ProjectRow) => void;
	onTogglePin: (project: ProjectRow) => void;
	onEdit: (project: ProjectRow) => void;
	onManageMembers: (project: ProjectRow) => void;
	onArchive: (project: ProjectRow) => void;
	onUnarchive: (project: ProjectRow) => void;
	onDelete: (project: ProjectRow) => void;
}) {
	const canEdit = project.canEdit;
	const canDelete = project.canDelete;

	return (
		<div className="flex justify-end">
			<DropdownMenuTrigger>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={`Actions for ${project.name}`}
				>
					<MoreHorizontalIcon />
				</Button>
				<DropdownMenu>
					<DropdownMenuItem onAction={() => onOpen(project)}>
						<ArrowUpRightIcon aria-hidden />
						Open project
					</DropdownMenuItem>
					<DropdownMenuItem
						onAction={() => onTogglePin(project)}
						// An archived project cannot be newly pinned. An existing
						// pin is still removable, so the user is never stuck.
						isDisabled={project.status === "archived" && !project.pinned}
					>
						{project.pinned ? (
							<PinOffIcon aria-hidden />
						) : (
							<PinIcon aria-hidden />
						)}
						{project.pinned ? "Unpin project" : "Pin project"}
					</DropdownMenuItem>
					{(canEdit || canDelete) && <DropdownMenuSeparator />}
					{canEdit && project.status !== "archived" && (
						<>
							<DropdownMenuItem onAction={() => onEdit(project)}>
								<PencilIcon aria-hidden />
								Edit project
							</DropdownMenuItem>
							<DropdownMenuItem onAction={() => onManageMembers(project)}>
								<UsersIcon aria-hidden />
								Manage members
							</DropdownMenuItem>
						</>
					)}
					{canEdit &&
						(project.status === "archived" ? (
							<DropdownMenuItem onAction={() => onUnarchive(project)}>
								<ArchiveRestoreIcon aria-hidden />
								Restore project
							</DropdownMenuItem>
						) : (
							<DropdownMenuItem onAction={() => onArchive(project)}>
								<ArchiveIcon aria-hidden />
								Archive project
							</DropdownMenuItem>
						))}
					{canDelete && (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								variant="destructive"
								onAction={() => onDelete(project)}
							>
								<Trash2Icon aria-hidden />
								Delete project
							</DropdownMenuItem>
						</>
					)}
				</DropdownMenu>
			</DropdownMenuTrigger>
		</div>
	);
}

export function ProjectsTable({
	projects,
	sorting,
	onSortingChange,
	selected,
	onSelectedChange,
	onEdit,
	onManageMembers,
	onArchive,
	onUnarchive,
	onDelete,
	onOpen,
	onTogglePin,
	emptyState,
}: ProjectsTableProps) {
	const columns = useMemo<ColumnDef<ProjectRow>[]>(
		() => [
			{
				id: "project",
				accessorFn: (row) => `${row.name} ${row.slug}`,
				header: "Project",
				cell: ({ row }) => (
					<div className="flex min-w-0 items-center gap-2.5">
						<UserAvatar
							size="sm"
							shape="square"
							name={row.original.name}
							src={row.original.logo}
						/>
						<div className="flex min-w-0 flex-col">
							<span className="flex max-w-56 items-center gap-1.5">
								<span
									className="min-w-0 truncate font-medium text-app-text"
									title={row.original.name}
								>
									{row.original.name}
								</span>
								{row.original.pinned && (
									<span className="flex shrink-0 items-center" title="Pinned">
										<PinIcon
											className="size-3.5 text-app-text-muted"
											aria-hidden
										/>
										<span className="sr-only">Pinned</span>
									</span>
								)}
							</span>
							<span
								className="max-w-56 truncate text-xs text-app-text-muted"
								title={row.original.slug}
							>
								{row.original.slug}
							</span>
						</div>
					</div>
				),
			},
			{
				id: "members",
				accessorFn: (row) => row.memberCount,
				header: "Members",
				enableSorting: false,
				cell: ({ row }) => (
					<span className="text-sm text-app-text-muted">
						{row.original.memberCount}
					</span>
				),
			},
			{
				id: "role",
				accessorFn: (row) => row.myRole,
				header: "Your role",
				enableSorting: false,
				cell: ({ row }) => <ProjectRoleChip role={row.original.myRole} />,
			},
			{
				id: "status",
				accessorFn: (row) => row.status,
				header: "Status",
				enableSorting: false,
				cell: ({ row }) => <ProjectStatusBadge status={row.original.status} />,
			},
			{
				id: "updatedAt",
				accessorFn: (row) => row.updatedAt,
				header: "Updated",
				sortingFn: "datetime",
				cell: ({ row }) => (
					<span
						className="text-sm text-app-text-muted"
						title={formatDateTime(row.original.updatedAt)}
					>
						{formatDate(row.original.updatedAt)}
					</span>
				),
			},
			{
				id: "actions",
				header: "",
				enableSorting: false,
				cell: ({ row }) => (
					<ProjectActions
						project={row.original}
						onOpen={onOpen}
						onTogglePin={onTogglePin}
						onEdit={onEdit}
						onManageMembers={onManageMembers}
						onArchive={onArchive}
						onUnarchive={onUnarchive}
						onDelete={onDelete}
					/>
				),
			},
		],
		[
			onOpen,
			onTogglePin,
			onEdit,
			onManageMembers,
			onArchive,
			onUnarchive,
			onDelete,
		],
	);

	const table = useReactTable({
		data: projects,
		columns,
		state: { sorting },
		onSortingChange: (updater) => {
			onSortingChange(
				typeof updater === "function" ? updater(sorting) : updater,
			);
		},
		// The API sorts the whole workspace; the browser only tracks state.
		manualSorting: true,
		getRowId: (row) => row.id,
		getCoreRowModel: getCoreRowModel(),
	});

	const sortDescriptor = useMemo<SortDescriptor | undefined>(() => {
		const first = sorting[0];

		if (!first) return undefined;

		// "createdAt" is an API sort field with no matching table column, so
		// there is no header to mark. Passing it anyway would point react-aria
		// at a column that does not exist.
		if (first.id !== "project" && first.id !== "updatedAt") return undefined;

		return {
			column: first.id,
			direction: first.desc ? "descending" : "ascending",
		};
	}, [sorting]);

	const rows = table.getRowModel().rows;
	const visibleIds = rows.map((row) => row.id);

	// Only offer selection when the caller can act on at least one row, so a
	// client or plain member never sees a checkbox that leads nowhere.
	const selectable = projects.some(
		(project) => project.canEdit || project.canDelete,
	);

	function handleSelectionChange(keys: Selection) {
		if (keys === "all") {
			onSelectedChange(new Set(visibleIds.slice(0, BULK_SELECTION_MAX)));
			return;
		}

		// Clamp even though a page cannot currently exceed the route limit. A
		// future page size change must not silently produce a rejected request.
		onSelectedChange(
			new Set(Array.from(keys).map(String).slice(0, BULK_SELECTION_MAX)),
		);
	}

	return (
		<Table
			aria-label="Projects"
			containerClassName="overflow-visible"
			selectionMode={selectable ? "multiple" : "none"}
			selectedKeys={selected}
			onSelectionChange={handleSelectionChange}
			sortDescriptor={sortDescriptor}
			onSortChange={(descriptor) => {
				onSortingChange([
					{
						id: String(descriptor.column),
						desc: descriptor.direction === "descending",
					},
				]);
			}}
		>
			<TableHeader>
				{selectable && (
					<TableHead className={`${STICKY_HEADER} w-10`}>
						<Checkbox slot="selection" aria-label="Select all projects" />
					</TableHead>
				)}
				{(table.getHeaderGroups()[0]?.headers ?? []).map((header) => {
					const sorted = header.column.getIsSorted();
					const canSort = header.column.getCanSort();
					const label =
						typeof header.column.columnDef.header === "string"
							? header.column.columnDef.header
							: header.column.id;
					// Tell the user what the next click will do, not just the
					// current state.
					const hint = canSort
						? `Sort by ${label} ${sorted === "asc" ? "descending" : "ascending"}`
						: undefined;

					return (
						<TableHead
							key={header.id}
							id={header.column.id}
							isRowHeader={header.column.id === "project"}
							allowsSorting={canSort}
							className={`${STICKY_HEADER}${canSort ? " cursor-pointer" : ""}`}
						>
							{header.isPlaceholder ? null : (
								<span className="inline-flex items-center gap-1.5" title={hint}>
									{flexRender(
										header.column.columnDef.header,
										header.getContext(),
									)}
									{canSort && <SortIndicator direction={sorted} />}
								</span>
							)}
						</TableHead>
					);
				})}
			</TableHeader>
			<TableBody renderEmptyState={() => emptyState}>
				{rows.map((row) => (
					<TableRow key={row.id} id={row.id}>
						{selectable && (
							<TableCell>
								<Checkbox
									slot="selection"
									aria-label={`Select ${row.original.name}`}
								/>
							</TableCell>
						)}
						{row.getVisibleCells().map((cell) => (
							<TableCell key={cell.id}>
								{flexRender(cell.column.columnDef.cell, cell.getContext())}
							</TableCell>
						))}
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}
