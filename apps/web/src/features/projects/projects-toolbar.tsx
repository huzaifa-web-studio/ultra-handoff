/**
 * Projects search, status filter, refresh and bulk action controls.
 *
 * Why the bulk bar lives here: it needs a stable row above the table, and the
 * buttons only make sense next to the filters that produced the visible rows.
 *
 * Why no sort control: the table headers (Project and Updated) already sort
 * and show the direction, so a second sort input would duplicate the same
 * state and could disagree with the header indicator.
 *
 * Used by: routes/_app/$orgSlug.projects.index.tsx.
 */

import { Button } from "@org/ui/components/button";
import { Input } from "@org/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@org/ui/components/select";
import {
	ArchiveIcon,
	ArchiveRestoreIcon,
	RefreshCwIcon,
	SearchIcon,
	Trash2Icon,
	XIcon,
} from "lucide-react";

import { BulkActionBar } from "#/components/data-table/bulk-action-bar";
import { BULK_SELECTION_MAX } from "#/lib/limits";
import { PROJECT_SEARCH_MAX } from "./schema";

type ProjectStatusFilter = "all" | "active" | "archived";

type ProjectsToolbarProps = {
	search: string;
	onSearchChange: (value: string) => void;
	status: ProjectStatusFilter;
	onStatusChange: (value: ProjectStatusFilter) => void;
	/**
	 * False for members and clients who cannot see archived projects. The
	 * Archived filter is meaningless to them, so it is not offered.
	 */
	canSeeArchived: boolean;
	/** Rows matching the current search and status. */
	visibleCount: number;
	/** Every project the caller can see, ignoring status and search. */
	totalCount: number;
	/** Rows ticked in the table. */
	selectedCount: number;
	onClearSelection: () => void;
	/** True when at least one selected row can be archived. */
	canArchive: boolean;
	/** True when at least one selected row can be restored. */
	canRestore: boolean;
	/** True when at least one selected row can be deleted. */
	canDelete: boolean;
	onBulkArchive: () => void;
	onBulkRestore: () => void;
	onBulkDelete: () => void;
	onRefresh: () => void;
	isRefreshing?: boolean;
};

export function ProjectsToolbar({
	search,
	onSearchChange,
	status,
	onStatusChange,
	canSeeArchived,
	visibleCount,
	totalCount,
	selectedCount,
	onClearSelection,
	canArchive,
	canRestore,
	canDelete,
	onBulkArchive,
	onBulkRestore,
	onBulkDelete,
	onRefresh,
	isRefreshing = false,
}: ProjectsToolbarProps) {
	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-wrap items-center gap-3">
				<div className="relative w-full max-w-xs">
					<SearchIcon
						className="pointer-events-none absolute top-1/2 left-0 size-3.5 -translate-y-1/2 text-app-text-muted"
						aria-hidden
					/>
					<Input
						type="search"
						value={search}
						onChange={(event) => onSearchChange(event.target.value)}
						placeholder="Search name or slug"
						aria-label="Search projects"
						// The list route rejects a longer search string, so stop
						// the input before the request can fail.
						maxLength={PROJECT_SEARCH_MAX}
						className="pl-6"
					/>
					{search.length > 0 && (
						<Button
							variant="ghost"
							size="icon-xs"
							className="absolute top-1/2 right-0 -translate-y-1/2"
							aria-label="Clear project search"
							onPress={() => onSearchChange("")}
						>
							<XIcon />
						</Button>
					)}
				</div>

				<Select
					aria-label="Filter projects by status"
					selectedKey={status}
					onSelectionChange={(key) => {
						if (key === "all" || key === "active" || key === "archived") {
							onStatusChange(key);
						}
					}}
				>
					<SelectTrigger size="sm" className="w-36">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem id="active">Active</SelectItem>
						{canSeeArchived && <SelectItem id="archived">Archived</SelectItem>}
						<SelectItem id="all">All projects</SelectItem>
					</SelectContent>
				</Select>

				<Button
					variant="outline"
					size="icon-sm"
					aria-label="Refresh projects"
					isDisabled={isRefreshing}
					onPress={onRefresh}
				>
					<RefreshCwIcon
						className={isRefreshing ? "animate-spin" : undefined}
						aria-hidden
					/>
				</Button>

				<p className="ml-auto text-xs text-app-text-muted">
					{visibleCount === totalCount
						? `${totalCount} project${totalCount === 1 ? "" : "s"}`
						: `${visibleCount} of ${totalCount} projects`}
				</p>
			</div>

			{selectedCount > 0 && (
				<BulkActionBar
					count={selectedCount}
					max={BULK_SELECTION_MAX}
					onClear={onClearSelection}
				>
					{canArchive && (
						<Button
							size="sm"
							variant="outline"
							aria-label="Archive selected projects"
							onPress={onBulkArchive}
						>
							<ArchiveIcon aria-hidden />
							<span className="hidden sm:inline">Archive</span>
						</Button>
					)}
					{canRestore && (
						<Button
							size="sm"
							variant="outline"
							aria-label="Restore selected projects"
							onPress={onBulkRestore}
						>
							<ArchiveRestoreIcon aria-hidden />
							<span className="hidden sm:inline">Restore</span>
						</Button>
					)}
					{canDelete && (
						<Button
							size="sm"
							variant="destructive"
							aria-label="Delete selected projects"
							onPress={onBulkDelete}
						>
							<Trash2Icon aria-hidden />
							<span className="hidden sm:inline">Delete</span>
						</Button>
					)}
					{!canArchive && !canRestore && !canDelete && (
						<p className="text-xs text-app-text-muted">
							You cannot change the selected projects.
						</p>
					)}
				</BulkActionBar>
			)}
		</div>
	);
}
