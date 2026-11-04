"use client";

/**
 * The milestones tab.
 *
 * Why this component owns the layout: the milestone tab is the one surface in
 * the project that fills the viewport. On a wide screen it is a resizable split
 * with the list on the left and the detail on the right. On a narrow screen the
 * list takes the screen and the detail opens from the right as a sheet, so the
 * detail always comes from the side it occupies on a wide screen.
 *
 * Selection lives in the URL as `?milestone=<id>`. That gives deep links,
 * refresh survival, and, on a phone, the hardware back button closing the
 * detail sheet.
 *
 * The project is loaded through the same query the workspace already ran, so
 * this only reads the cached detail to get the members for the assignee picker
 * and the project id for the API paths.
 *
 * Used by: routes/_app/$orgSlug.projects.$projectSlug.milestones.tsx.
 */

import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
	useDefaultLayout,
} from "@org/ui/components/resizable";
import { Sheet } from "@org/ui/components/sheet";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { useProjectDetailBySlug } from "#/features/projects/hooks";
import { useDebouncedValue } from "#/hooks/use-debounced-value";
import { useMediaQuery } from "#/hooks/use-media-query";
import type { MilestoneDetail } from "./api";
import { milestonesKey, useMilestones } from "./hooks";
import {
	MilestoneDetailPanel,
	type MilestoneTabKey,
} from "./milestone-detail-panel";
import { MilestoneListPanel } from "./milestone-list-panel";
import {
	MILESTONE_PAGE_SIZE,
	type MilestoneFilters,
	type MilestoneSort,
	type MilestoneStatusFilter,
} from "./schema";

/** Selection setters supplied by the route, which owns the URL. */
export type MilestoneSelectionHandler = (
	id: string | null,
	options?: { replace?: boolean },
) => void;

export function MilestonePage({
	orgSlug,
	projectSlug,
	selectedId,
	selectedTab,
	onSelect,
	onTabChange,
}: {
	orgSlug: string;
	projectSlug: string;
	selectedId: string | null;
	selectedTab: MilestoneTabKey;
	onSelect: MilestoneSelectionHandler;
	onTabChange: (tab: MilestoneTabKey) => void;
}) {
	const projectQuery = useProjectDetailBySlug(orgSlug, projectSlug);
	const projectId = projectQuery.data?.project.id ?? "";
	const organizationId = projectQuery.data?.organizationId ?? "";
	const members = projectQuery.data?.members ?? [];

	const isDesktop = useMediaQuery("(min-width: 1024px)");
	const queryClient = useQueryClient();

	// Filters. The search input stays immediate while the request waits for the
	// debounced value, so typing never feels laggy.
	const [search, setSearch] = useState("");
	const debouncedSearch = useDebouncedValue(search, 300);
	const [status, setStatus] = useState<MilestoneStatusFilter>("active");
	const [sort, setSort] = useState<MilestoneSort>("dueDate");
	const [direction, setDirection] = useState<"asc" | "desc">("asc");

	// Bumped by the external update banner to remount the detail pane. A
	// remount is the only reliable way to drop the editor draft and history.
	const [detailVersion, setDetailVersion] = useState(0);

	const filters: MilestoneFilters = {
		search: debouncedSearch,
		status,
		sort,
		direction,
		pageSize: MILESTONE_PAGE_SIZE,
	};

	const query = useMilestones(orgSlug, projectId, filters);

	const pages = query.data?.pages ?? [];
	const milestones = pages.flatMap((page) => page.milestones);
	const counts = pages[0]?.counts ?? null;
	const total = pages[0]?.total ?? 0;
	const viewer = pages[0]?.viewer;
	const canWrite = viewer?.canWrite ?? false;
	const locked = viewer?.locked ?? false;

	// Row elements, so closing the mobile sheet can return focus to the row that
	// opened it instead of dropping focus on the body.
	const rowRefs = useRef(new Map<string, HTMLButtonElement>());

	const firstId = milestones[0]?.id ?? null;

	// On a wide screen the detail pane should never be empty when rows exist.
	useEffect(() => {
		if (!isDesktop || selectedId || !firstId) return;

		onSelect(firstId, { replace: true });
	}, [isDesktop, selectedId, firstId, onSelect]);

	function closeDetail() {
		const element = selectedId ? rowRefs.current.get(selectedId) : null;

		onSelect(null);
		element?.focus();
	}

	function registerRowRef(id: string, element: HTMLButtonElement | null) {
		if (element) {
			rowRefs.current.set(id, element);
		} else {
			rowRefs.current.delete(id);
		}
	}

	function handleFiltersChange(next: Partial<MilestoneFilters>) {
		if (next.search !== undefined) setSearch(next.search);
		if (next.status !== undefined) setStatus(next.status);
		if (next.sort !== undefined) setSort(next.sort);
		if (next.direction !== undefined) setDirection(next.direction);
	}

	function handleCreated(milestone: MilestoneDetail) {
		onSelect(milestone.id);
	}

	function handleDeleted() {
		onSelect(null);
	}

	/**
	 * Discard the local draft and show the server version.
	 *
	 * The invalidation is awaited so the remounted pane reads fresh data, not
	 * the cache entry the banner was warning about.
	 */
	async function reloadDetail() {
		await queryClient.invalidateQueries({
			queryKey: milestonesKey(orgSlug, projectId),
		});
		setDetailVersion((current) => current + 1);
	}

	function loadMore() {
		void query.fetchNextPage();
	}

	const layout = useDefaultLayout({ id: "handoff-milestone-split-v2" });

	const list = (
		<MilestoneListPanel
			orgSlug={orgSlug}
			organizationId={organizationId}
			projectId={projectId}
			members={members}
			filters={{ ...filters, search }}
			onFiltersChange={handleFiltersChange}
			counts={counts}
			milestones={milestones}
			total={total}
			isPending={query.isPending}
			isError={query.isError}
			errorMessage={query.error instanceof Error ? query.error.message : null}
			hasNextPage={Boolean(query.hasNextPage)}
			isFetchingNextPage={query.isFetchingNextPage}
			onLoadMore={loadMore}
			onRetry={() => void query.refetch()}
			selectedId={selectedId}
			onSelect={(id) => onSelect(id)}
			onCreated={handleCreated}
			canWrite={canWrite}
			registerRowRef={registerRowRef}
		/>
	);

	return (
		<div className="flex h-full min-h-0 flex-col gap-3">
			{locked && (
				<p className="border border-warning bg-warning-bg p-3 text-xs text-warning">
					This project is archived, so its milestones are read only. Restore the
					project to make changes.
				</p>
			)}

			{/* Wide screens: resizable split, list left, detail right. */}
			{isDesktop && (
				<div className="min-h-0 flex-1">
					<ResizablePanelGroup
						orientation="horizontal"
						defaultLayout={layout.defaultLayout}
						onLayoutChanged={layout.onLayoutChanged}
					>
						<ResizablePanel
							id="list"
							defaultSize="34"
							minSize="24"
							maxSize="46"
						>
							<div className="h-full pr-2">{list}</div>
						</ResizablePanel>

						<ResizableHandle withHandle />

						<ResizablePanel id="detail" defaultSize="66" minSize="40">
							<div className="h-full pl-2">
								<MilestoneDetailPanel
									key={`${selectedId ?? "none"}-${detailVersion}`}
									orgSlug={orgSlug}
									organizationId={organizationId}
									projectId={projectId}
									milestoneId={selectedId}
									members={members}
									selectedTab={selectedTab}
									onTabChange={onTabChange}
									onReload={() => void reloadDetail()}
									onDeleted={handleDeleted}
								/>
							</div>
						</ResizablePanel>
					</ResizablePanelGroup>
				</div>
			)}

			{/* Narrow screens: the list fills the screen. */}
			{!isDesktop && <div className="flex min-h-0 flex-1 flex-col">{list}</div>}

			{/*
			 * Narrow screens: the detail slides in from the right, the same side
			 * the detail occupies on a wide screen.
			 */}
			{!isDesktop && (
				<Sheet
					isOpen={Boolean(selectedId)}
					onOpenChange={(open) => {
						if (!open) closeDetail();
					}}
					side="right"
					size="full"
					showCloseButton={false}
					className="bg-app-panel"
				>
					{selectedId && (
						<MilestoneDetailPanel
							key={`${selectedId}-${detailVersion}`}
							orgSlug={orgSlug}
							organizationId={organizationId}
							projectId={projectId}
							milestoneId={selectedId}
							members={members}
							selectedTab={selectedTab}
							onTabChange={onTabChange}
							onClose={closeDetail}
							onReload={() => void reloadDetail()}
							onDeleted={handleDeleted}
						/>
					)}
				</Sheet>
			)}
		</div>
	);
}
