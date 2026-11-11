"use client";

/**
 * The change request cards on the milestone Overview.
 *
 * Why its own component: the Overview needs the titles and statuses of every
 * request without duplicating the Changes tab. It reads the same query key, so
 * opening the tab reuses the response instead of fetching again.
 *
 * The cards are buttons: one press opens the Changes tab where the request can
 * be read and decided. A nested action list here would duplicate that surface.
 *
 * Used by: milestone-detail-panel.tsx.
 */

import { Button } from "@org/ui/components/button";
import { formatDate } from "#/lib/date";
import { ChangeRequestStatusChip } from "./change-request-status-chip";
import { useChangeRequests } from "./hooks";

export function OverviewChanges({
	orgSlug,
	projectId,
	milestoneId,
	active,
	onOpen,
}: {
	orgSlug: string;
	projectId: string;
	milestoneId: string;
	/** True while the Overview is visible, which is when the cards are worth loading. */
	active: boolean;
	onOpen: () => void;
}) {
	const query = useChangeRequests(orgSlug, projectId, milestoneId, {
		enabled: active,
	});

	if (query.isPending) {
		return (
			<div className="flex flex-col gap-2" aria-hidden>
				<div className="h-11 animate-pulse bg-app-panel-subtle" />
				<div className="h-11 animate-pulse bg-app-panel-subtle" />
			</div>
		);
	}

	if (query.isError) {
		return (
			<div className="flex flex-wrap items-center gap-2 border border-danger bg-danger-bg p-2 text-xs text-danger">
				<span className="flex-1">
					{query.error instanceof Error
						? query.error.message
						: "Could not load the change requests."}
				</span>
				<Button
					size="xs"
					variant="surface"
					onPress={() => void query.refetch()}
				>
					Try again
				</Button>
			</div>
		);
	}

	const requests = query.data?.changeRequests ?? [];

	if (requests.length === 0) {
		return (
			<p className="border border-dashed border-app-border p-3 text-sm text-app-text-muted">
				No change requests yet.
			</p>
		);
	}

	return (
		<ul className="flex flex-col gap-2">
			{requests.map((request) => (
				<li key={request.id}>
					<button
						type="button"
						onClick={onOpen}
						className="flex w-full cursor-pointer items-center gap-2 border border-app-border bg-app-panel p-2 text-left transition-colors hover:bg-app-panel-subtle focus-visible:ring-2 focus-visible:ring-ring/30"
					>
						<span className="flex min-w-0 flex-1 flex-col gap-0.5">
							<span className="truncate text-xs font-medium text-app-text">
								{request.title}
							</span>
							<span className="truncate text-[0.65rem] text-app-text-muted">
								{request.requestedBy?.name ?? "Former member"} ·{" "}
								{formatDate(request.createdAt)}
							</span>
						</span>
						<ChangeRequestStatusChip status={request.status} />
					</button>
				</li>
			))}
		</ul>
	);
}
