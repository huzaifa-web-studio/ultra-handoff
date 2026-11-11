"use client";

/**
 * The Changes tab inside the milestone detail pane.
 *
 * Why its own tab: a change request is a structured record, not a comment. The
 * client asks, the agency decides, and the answer stays attached to the
 * question. Putting it beside the discussion would make two different things
 * read as one thread.
 *
 * Behaviour worth knowing:
 *   - the list only loads once the tab is opened
 *   - the default filter is Open, because that is the work waiting on the team
 *   - creating and editing use the comment editor, so attachments and mentions
 *     work without a second rich text stack
 *   - accept is disabled while the milestone is locked, because accepting
 *     implies a scope edit. Decline, withdraw and move stay available.
 *
 * Used by: milestone-detail-panel.tsx.
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
import { PlusIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import { useState } from "react";
import type { AssignableMember } from "../milestone-assignee-field";
import { MilestoneCreateDialog } from "../milestone-create-dialog";
import type { ChangeRequest, ChangeRequestStatus } from "./api";
import { ChangeRequestDeclineDialog } from "./change-request-decline-dialog";
import { ChangeRequestDialog } from "./change-request-dialog";
import { ChangeRequestItem } from "./change-request-item";
import { CHANGE_REQUEST_STATUS_LABELS } from "./change-request-status-chip";
import {
	useChangeRequests,
	useDecideChangeRequest,
	useMoveChangeRequest,
} from "./hooks";

/** The filter mixes real statuses with one aggregate. */
type ChangesFilter = "open" | "all" | ChangeRequestStatus;

/** Filter options, in the order a person scans them. */
const FILTERS: { id: ChangesFilter; label: string }[] = [
	{ id: "open", label: "Open" },
	{ id: "all", label: "All" },
	{ id: "accepted", label: "Accepted" },
	{ id: "declined", label: "Declined" },
	{ id: "moved", label: "Moved" },
	{ id: "withdrawn", label: "Withdrawn" },
];

/** Read the count for one filter value. */
function countForFilter(
	counts: Record<ChangeRequestStatus, number>,
	filter: ChangesFilter,
): number {
	if (filter === "all") {
		return (
			counts.open +
			counts.accepted +
			counts.declined +
			counts.moved +
			counts.withdrawn
		);
	}

	return counts[filter];
}

export function ChangesTab({
	orgSlug,
	organizationId,
	projectSlug,
	projectId,
	milestoneId,
	milestoneLocked,
	archived,
	canCreate,
	canDecide,
	members,
	active,
}: {
	orgSlug: string;
	organizationId: string;
	projectSlug: string;
	projectId: string;
	milestoneId: string;
	/** True when the milestone lock blocks accepting a request. */
	milestoneLocked: boolean;
	/** True when the project is archived and every write is refused. */
	archived: boolean;
	/** True when this viewer may raise a request. */
	canCreate: boolean;
	/** True when this viewer may accept, decline or move. */
	canDecide: boolean;
	/** Project members, for the assignee picker in the move dialog. */
	members: AssignableMember[];
	/** True while this tab is selected, which is when the list is worth loading. */
	active: boolean;
}) {
	const query = useChangeRequests(orgSlug, projectId, milestoneId, {
		enabled: active,
	});
	const decide = useDecideChangeRequest(orgSlug, projectId, milestoneId);
	const move = useMoveChangeRequest(orgSlug, projectId, milestoneId);

	const [filter, setFilter] = useState<ChangesFilter>("open");
	const [search, setSearch] = useState("");
	const [createOpen, setCreateOpen] = useState(false);
	const [editing, setEditing] = useState<ChangeRequest | null>(null);
	const [declining, setDeclining] = useState<ChangeRequest | null>(null);
	const [moving, setMoving] = useState<ChangeRequest | null>(null);

	const data = query.data;
	const serverCanDecide = (data?.canDecide ?? canDecide) && !archived;
	const all = data?.changeRequests ?? [];
	const term = search.trim().toLowerCase();
	const searched = term
		? all.filter((request) => request.title.toLowerCase().includes(term))
		: all;

	// Counts follow the search, so a filter label never promises rows the
	// search has already removed.
	const counts: Record<ChangeRequestStatus, number> = {
		open: 0,
		accepted: 0,
		declined: 0,
		moved: 0,
		withdrawn: 0,
	};

	for (const request of searched) {
		counts[request.status] += 1;
	}

	const requests =
		filter === "all"
			? searched
			: searched.filter((request) => request.status === filter);
	const canWrite = canCreate && !archived;
	const hasSearch = term.length > 0;
	const hasFilter = hasSearch || filter !== "all";

	if (!active) return null;

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex flex-wrap items-center gap-2 border-b border-app-border p-3">
				<div className="relative min-w-0 flex-1">
					<SearchIcon
						className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-app-text-muted"
						aria-hidden
					/>
					<Input
						type="search"
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						placeholder="Search requests"
						aria-label="Search change requests"
						className="h-9 pl-8 text-sm"
					/>
				</div>

				<Select
					aria-label="Filter change requests"
					selectedKey={filter}
					onSelectionChange={(key) => {
						if (typeof key === "string") setFilter(key as ChangesFilter);
					}}
				>
					<SelectTrigger size="sm" className="w-48">
						<SelectValue>
							{() => {
								const option =
									FILTERS.find((item) => item.id === filter) ?? FILTERS[0];

								return `${option.label} (${countForFilter(counts, filter)})`;
							}}
						</SelectValue>
					</SelectTrigger>
					<SelectContent className="min-w-48">
						{FILTERS.map((option) => {
							const label = `${option.label} (${countForFilter(
								counts,
								option.id,
							)})`;

							return (
								<SelectItem key={option.id} id={option.id} textValue={label}>
									{label}
								</SelectItem>
							);
						})}
					</SelectContent>
				</Select>

				{canWrite && (
					<Button size="sm" onPress={() => setCreateOpen(true)}>
						<PlusIcon aria-hidden />
						New request
					</Button>
				)}
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto p-3">
				{query.isPending ? (
					<div className="flex flex-col gap-2">
						{["a", "b", "c"].map((row) => (
							<div
								key={row}
								className="h-16 animate-pulse bg-app-panel-subtle"
							/>
						))}
					</div>
				) : query.isError ? (
					<div className="flex flex-col gap-3 border border-danger bg-danger-bg p-3">
						<p role="alert" className="text-sm text-danger">
							{query.error instanceof Error
								? query.error.message
								: "Could not load the change requests."}
						</p>
						<Button
							variant="surface"
							size="sm"
							className="self-start"
							onPress={() => void query.refetch()}
						>
							<RefreshCwIcon aria-hidden />
							Try again
						</Button>
					</div>
				) : requests.length === 0 ? (
					<div className="flex flex-col items-center gap-2 py-12 text-center">
						<p className="text-sm font-medium text-app-text">
							{all.length === 0
								? "No change requests yet"
								: hasSearch
									? "No requests match this search"
									: filter === "open"
										? "No open change requests"
										: `No ${CHANGE_REQUEST_STATUS_LABELS[
												filter as ChangeRequestStatus
											]?.toLowerCase()} requests`}
						</p>
						<p className="max-w-xs text-xs text-app-text-muted">
							{all.length === 0
								? "Ask for a change here when the agreed scope needs to grow or move."
								: hasSearch
									? "Try a different title, or clear the search."
									: "Try another filter, or open all requests."}
						</p>

						{all.length === 0
							? canWrite && (
									<Button size="sm" onPress={() => setCreateOpen(true)}>
										<PlusIcon aria-hidden />
										Raise a change request
									</Button>
								)
							: hasFilter && (
									<Button
										size="sm"
										variant="outline"
										onPress={() => {
											setSearch("");
											setFilter("all");
										}}
									>
										Clear filters
									</Button>
								)}
					</div>
				) : (
					<ul className="flex flex-col gap-2">
						{requests.map((request) => (
							<ChangeRequestItem
								key={request.id}
								request={request}
								orgSlug={orgSlug}
								projectSlug={projectSlug}
								canDecide={serverCanDecide}
								milestoneLocked={milestoneLocked}
								archived={archived}
								pending={
									decide.isPending && decide.variables?.changeId === request.id
								}
								onEdit={setEditing}
								onDecline={setDeclining}
								onMove={setMoving}
								onAccept={(target) => {
									decide.mutate({
										changeId: target.id,
										status: "accepted",
									});
								}}
								onWithdraw={(target) => {
									decide.mutate({
										changeId: target.id,
										status: "withdrawn",
									});
								}}
							/>
						))}
					</ul>
				)}
			</div>

			{createOpen && (
				<ChangeRequestDialog
					orgSlug={orgSlug}
					organizationId={organizationId}
					projectId={projectId}
					milestoneId={milestoneId}
					isOpen={createOpen}
					onOpenChange={setCreateOpen}
					onSaved={() => setFilter("open")}
				/>
			)}

			{editing && (
				<ChangeRequestDialog
					orgSlug={orgSlug}
					organizationId={organizationId}
					projectId={projectId}
					milestoneId={milestoneId}
					request={editing}
					isOpen={editing !== null}
					onOpenChange={(open) => {
						if (!open) setEditing(null);
					}}
				/>
			)}

			<ChangeRequestDeclineDialog
				orgSlug={orgSlug}
				projectId={projectId}
				milestoneId={milestoneId}
				request={declining}
				isOpen={declining !== null}
				onOpenChange={(open) => {
					if (!open) setDeclining(null);
				}}
			/>

			{moving && (
				<MilestoneCreateDialog
					orgSlug={orgSlug}
					organizationId={organizationId}
					projectId={projectId}
					members={members}
					isOpen={moving !== null}
					onOpenChange={(open) => {
						if (!open) setMoving(null);
					}}
					onCreated={() => {
						setMoving(null);
						setFilter("all");
					}}
					initialValues={{
						title: moving.title,
						description: moving.body,
					}}
					submitLabel="Create milestone"
					dialogTitle="Move to a new milestone"
					dialogDescription="This creates a new milestone in this project and marks the request as moved. The current milestone is not changed."
					submit={async (input) => {
						// The body was already validated when the request was stored.
						// Sending an identical copy would re-check the mentions, so it
						// is dropped and the server trusts the stored value.
						const unchangedBody =
							JSON.stringify(input.description) === JSON.stringify(moving.body);
						const result = await move.mutateAsync({
							changeId: moving.id,
							input: {
								title: input.title,
								status: input.status,
								statusNote: input.statusNote,
								startDate: input.startDate,
								dueDate: input.dueDate,
								estimateMinutes: input.estimateMinutes,
								assigneeUserIds: input.assigneeUserIds,
								...(unchangedBody || input.description === undefined
									? {}
									: { description: input.description }),
							},
						});

						return { milestone: result.milestone };
					}}
				/>
			)}
		</div>
	);
}
