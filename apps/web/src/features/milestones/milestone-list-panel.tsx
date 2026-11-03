/**
 * The milestone list pane.
 *
 * Why its own component: the list is the left hand side of the split view and
 * the whole screen on a phone. It owns the filters and the create dialog, and
 * it reports the created milestone up so the page can select it.
 *
 * Filtering is server side on purpose. A project can accumulate many
 * milestones, and searching or filtering a fetched page in the browser would
 * silently search only that page.
 *
 * Used by: milestone-page.tsx.
 */

import { Button } from "@org/ui/components/button";
import { Input } from "@org/ui/components/input";
import { ScrollArea } from "@org/ui/components/scroll-area";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@org/ui/components/select";
import { cn } from "cn";
import { PlusIcon, SearchIcon } from "lucide-react";
import { useState } from "react";
import type { MilestoneCounts, MilestoneDetail, MilestoneSummary } from "./api";
import type { AssignableMember } from "./milestone-assignee-field";
import { MilestoneCreateDialog } from "./milestone-create-dialog";
import { MilestoneListItem } from "./milestone-list-item";
import {
	MILESTONE_STATUS_FILTER_ICONS,
	milestoneStatusTextClass,
} from "./milestone-status-style";
import type {
	MilestoneFilters,
	MilestoneSort,
	MilestoneStatusFilter,
} from "./schema";

/** Status filter options, in the order a person scans them. */
const STATUS_FILTER_OPTIONS: {
	id: MilestoneStatusFilter;
	label: string;
}[] = [
	{ id: "active", label: "Active" },
	{ id: "all", label: "All" },
	{ id: "todo", label: "To do" },
	{ id: "in_progress", label: "In progress" },
	{ id: "blocked", label: "Blocked" },
	{ id: "done", label: "Done" },
	{ id: "cancelled", label: "Cancelled" },
];

const SORT_OPTIONS: { id: MilestoneSort; label: string }[] = [
	{ id: "dueDate", label: "Due date" },
	{ id: "createdAt", label: "Created" },
	{ id: "title", label: "Title" },
];

/** Read the count for one filter value. */
function countForFilter(
	counts: MilestoneCounts,
	filter: MilestoneStatusFilter,
): number {
	switch (filter) {
		case "active":
			return counts.active;
		case "all":
			return counts.all;
		case "todo":
			return counts.todo;
		case "in_progress":
			return counts.inProgress;
		case "blocked":
			return counts.blocked;
		case "done":
			return counts.done;
		case "cancelled":
			return counts.cancelled;
	}
}

export function MilestoneListPanel({
	orgSlug,
	organizationId,
	projectId,
	members,
	filters,
	onFiltersChange,
	counts,
	milestones,
	total,
	isPending,
	isError,
	errorMessage,
	hasNextPage,
	isFetchingNextPage,
	onLoadMore,
	onRetry,
	selectedId,
	onSelect,
	onCreated,
	canWrite,
	registerRowRef,
}: {
	orgSlug: string;
	organizationId: string;
	projectId: string;
	members: AssignableMember[];
	filters: MilestoneFilters;
	onFiltersChange: (next: Partial<MilestoneFilters>) => void;
	counts: MilestoneCounts | null;
	milestones: MilestoneSummary[];
	total: number;
	isPending: boolean;
	isError: boolean;
	errorMessage: string | null;
	hasNextPage: boolean;
	isFetchingNextPage: boolean;
	onLoadMore: () => void;
	onRetry: () => void;
	selectedId: string | null;
	onSelect: (id: string) => void;
	onCreated: (milestone: MilestoneDetail) => void;
	canWrite: boolean;
	registerRowRef: (id: string, element: HTMLButtonElement | null) => void;
}) {
	const [createOpen, setCreateOpen] = useState(false);

	const filtered = filters.search.length > 0 || filters.status !== "active";
	const noMilestonesAtAll = counts !== null && counts.all === 0;
	const activeFilter =
		STATUS_FILTER_OPTIONS.find((option) => option.id === filters.status) ??
		STATUS_FILTER_OPTIONS[0];
	const activeFilterCount = counts ? countForFilter(counts, filters.status) : 0;

	return (
		<section
			aria-label="Milestones"
			className="flex h-full min-h-0 flex-col border border-app-border bg-app-panel"
		>
			{/* Toolbar */}
			<div className="flex flex-col gap-2 border-b border-app-border p-3">
				<div className="flex items-center gap-2">
					<div className="relative min-w-0 flex-1">
						<SearchIcon
							className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-app-text-muted"
							aria-hidden
						/>
						<Input
							type="search"
							value={filters.search}
							onChange={(event) =>
								onFiltersChange({ search: event.target.value })
							}
							placeholder="Search milestones"
							aria-label="Search milestones"
							className="h-9 pl-8 text-sm"
						/>
					</div>

					{canWrite && (
						<Button size="sm" onPress={() => setCreateOpen(true)}>
							<PlusIcon aria-hidden />
							New
						</Button>
					)}
				</div>

				<div className="flex flex-wrap items-center gap-2">
					<Select
						aria-label="Filter by status"
						selectedKey={filters.status}
						onSelectionChange={(key) => {
							if (typeof key === "string") {
								onFiltersChange({
									status: key as MilestoneStatusFilter,
								});
							}
						}}
					>
						<SelectTrigger size="sm" className="w-full sm:w-44">
							<SelectValue>
								{() => {
									const Icon = MILESTONE_STATUS_FILTER_ICONS[filters.status];

									return (
										<span
											className={cn(
												"inline-flex items-center gap-2",
												milestoneStatusTextClass(filters.status),
											)}
										>
											<Icon className="size-3.5 shrink-0" aria-hidden />
											{`${activeFilter.label} (${activeFilterCount})`}
										</span>
									);
								}}
							</SelectValue>
						</SelectTrigger>
						<SelectContent className="min-w-44">
							{STATUS_FILTER_OPTIONS.map((option) => {
								const label = `${option.label} (${
									counts ? countForFilter(counts, option.id) : 0
								})`;
								const Icon = MILESTONE_STATUS_FILTER_ICONS[option.id];

								return (
									<SelectItem key={option.id} id={option.id} textValue={label}>
										<span
											className={cn(
												"inline-flex items-center gap-2",
												milestoneStatusTextClass(option.id),
											)}
										>
											<Icon className="size-3.5 shrink-0" aria-hidden />
											{label}
										</span>
									</SelectItem>
								);
							})}
						</SelectContent>
					</Select>

					<Select
						aria-label="Sort milestones"
						selectedKey={filters.sort}
						onSelectionChange={(key) => {
							if (typeof key === "string") {
								onFiltersChange({ sort: key as MilestoneSort });
							}
						}}
					>
						<SelectTrigger size="sm" className="w-36">
							<SelectValue />
						</SelectTrigger>
						<SelectContent className="min-w-40">
							{SORT_OPTIONS.map((option) => (
								<SelectItem key={option.id} id={option.id}>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>

					<Button
						size="xs"
						variant="ghost"
						aria-label={
							filters.direction === "asc"
								? "Sorted ascending, switch to descending"
								: "Sorted descending, switch to ascending"
						}
						onPress={() =>
							onFiltersChange({
								direction: filters.direction === "asc" ? "desc" : "asc",
							})
						}
					>
						{filters.direction === "asc" ? "A to Z" : "Z to A"}
					</Button>
				</div>
			</div>

			{/* Rows */}
			<ScrollArea className="min-h-0 flex-1 overscroll-contain">
				{isPending ? (
					<div className="flex flex-col gap-2 p-3">
						{["a", "b", "c", "d", "e"].map((row) => (
							<div
								key={row}
								className="h-16 animate-pulse bg-app-panel-subtle"
							/>
						))}
					</div>
				) : isError ? (
					<div role="alert" className="flex flex-col gap-3 p-4">
						<p className="text-sm text-danger">
							{errorMessage ?? "Could not load the milestones."}
						</p>
						<Button size="sm" variant="outline" onPress={onRetry}>
							Try again
						</Button>
					</div>
				) : milestones.length === 0 ? (
					<div className="flex flex-col items-center gap-2 p-8 text-center">
						<p className="text-sm font-medium text-app-text">
							{noMilestonesAtAll
								? "No milestones yet"
								: "No milestones match these filters"}
						</p>
						<p className="text-xs text-app-text-muted">
							{noMilestonesAtAll
								? "Break the work into small, checkable pieces so everyone knows what is next."
								: "Try a different status or clear the search."}
						</p>

						{noMilestonesAtAll && canWrite ? (
							<Button size="sm" onPress={() => setCreateOpen(true)}>
								<PlusIcon aria-hidden />
								Create the first milestone
							</Button>
						) : (
							filtered && (
								<Button
									size="sm"
									variant="outline"
									onPress={() =>
										onFiltersChange({
											search: "",
											status: "active",
										})
									}
								>
									Clear filters
								</Button>
							)
						)}
					</div>
				) : (
					<>
						<ul className="flex flex-col divide-y divide-app-border">
							{milestones.map((milestone) => (
								<li key={milestone.id}>
									<MilestoneListItem
										milestone={milestone}
										selected={milestone.id === selectedId}
										onSelect={() => onSelect(milestone.id)}
										buttonRef={(element) =>
											registerRowRef(milestone.id, element)
										}
									/>
								</li>
							))}
						</ul>

						{hasNextPage && (
							<div className="p-3">
								<Button
									size="sm"
									variant="ghost"
									className="w-full"
									loading={isFetchingNextPage}
									onPress={onLoadMore}
								>
									Load more
								</Button>
							</div>
						)}
					</>
				)}
			</ScrollArea>

			{/* Footer */}
			<div className="border-t border-app-border px-3 py-2 text-xs text-app-text-muted">
				{milestones.length === 0
					? "No milestones shown"
					: `${milestones.length} of ${total} shown`}
			</div>

			{/* Mounted only while open, so every open starts with a clean form. */}
			{createOpen && (
				<MilestoneCreateDialog
					orgSlug={orgSlug}
					organizationId={organizationId}
					projectId={projectId}
					members={members}
					isOpen={createOpen}
					onOpenChange={(open) => setCreateOpen(open)}
					onCreated={onCreated}
				/>
			)}
		</section>
	);
}
