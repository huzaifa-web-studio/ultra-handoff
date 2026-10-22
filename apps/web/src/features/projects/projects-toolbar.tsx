/**
 * Projects search, status filter and refresh controls.
 *
 * Why no sort control: the table headers (Project and Updated) already sort
 * and show the direction, so a second sort input would duplicate the same
 * state and could disagree with the header indicator.
 *
 * Used by: routes/_app/$orgSlug.projects.tsx.
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
import { RefreshCwIcon, SearchIcon, XIcon } from "lucide-react";

type ProjectStatusFilter = "all" | "active" | "archived";

type ProjectsToolbarProps = {
	search: string;
	onSearchChange: (value: string) => void;
	status: ProjectStatusFilter;
	onStatusChange: (value: ProjectStatusFilter) => void;
	/** Rows matching the current search and status. */
	visibleCount: number;
	/** Every project the caller can see, ignoring status and search. */
	totalCount: number;
	onRefresh: () => void;
	isRefreshing?: boolean;
};

export function ProjectsToolbar({
	search,
	onSearchChange,
	status,
	onStatusChange,
	visibleCount,
	totalCount,
	onRefresh,
	isRefreshing = false,
}: ProjectsToolbarProps) {
	return (
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
					<SelectItem id="archived">Archived</SelectItem>
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
	);
}
