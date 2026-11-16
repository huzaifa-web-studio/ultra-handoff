"use client";

/**
 * One change request row and its detail.
 *
 * Why an expandable card instead of a second master and detail split: the
 * milestone pane is already the right hand side of a split, so a nested split
 * would leave two narrow columns. Expanding in place keeps the list scannable
 * and gives the body the full width of the pane when it is read.
 *
 * Used by: changes-tab.tsx.
 */

import { Button } from "@org/ui/components/button";
import { Link } from "@tanstack/react-router";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import { formatDate } from "#/lib/date";
import { CommentBody } from "../comments/editor/comment-editor";
import type { ChangeRequest } from "./api";
import { ChangeRequestStatusChip } from "./change-request-status-chip";

/** A checklist inside a request is text, not a progress tracker. */
async function ignoreChecklistToggle(): Promise<void> {
	// Intentionally empty. The request body is a description, not a work item.
}

export function ChangeRequestItem({
	request,
	orgSlug,
	projectSlug,
	canDecide,
	archived,
	pending,
	onEdit,
	onAccept,
	onDecline,
	onMove,
	onWithdraw,
	onOpenScope,
}: {
	request: ChangeRequest;
	orgSlug: string;
	projectSlug: string;
	/** True when this viewer may accept, decline or move. */
	canDecide: boolean;
	/** True when the project is archived, so no action is offered. */
	archived: boolean;
	/** True while a decision for this request is in flight. */
	pending: boolean;
	onEdit: (request: ChangeRequest) => void;
	onAccept: (request: ChangeRequest) => void;
	onDecline: (request: ChangeRequest) => void;
	onMove: (request: ChangeRequest) => void;
	onWithdraw: (request: ChangeRequest) => void;
	/** Open the section an acceptance created, or the Scope index. */
	onOpenScope?: (scopeEntryId: string | null) => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const [confirmWithdraw, setConfirmWithdraw] = useState(false);
	const open = request.status === "open";

	return (
		<li className="border border-app-border bg-app-panel">
			<button
				type="button"
				aria-expanded={expanded}
				onClick={() => setExpanded((current) => !current)}
				className="flex w-full cursor-pointer items-start gap-2 p-3 text-left outline-none transition-colors hover:bg-app-panel-subtle focus-visible:ring-2 focus-visible:ring-ring/30"
			>
				{expanded ? (
					<ChevronDownIcon
						className="mt-0.5 size-4 shrink-0 text-app-text-muted"
						aria-hidden
					/>
				) : (
					<ChevronRightIcon
						className="mt-0.5 size-4 shrink-0 text-app-text-muted"
						aria-hidden
					/>
				)}

				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<div className="flex min-w-0 items-center gap-2">
						<span className="min-w-0 flex-1 truncate text-sm font-medium text-app-text">
							{request.title}
						</span>
						<ChangeRequestStatusChip status={request.status} />
					</div>

					<span className="text-xs text-app-text-muted">
						{request.requestedBy?.name ?? "Former member"} ·{" "}
						{formatDate(request.createdAt)}
						{request.decidedAt && (
							<> · decided {formatDate(request.decidedAt)}</>
						)}
					</span>

					{!expanded && request.bodyText.length > 0 && (
						<span className="line-clamp-2 text-xs text-app-text-muted">
							{request.bodyText}
						</span>
					)}
				</div>
			</button>

			{expanded && (
				<div className="flex flex-col gap-3 border-t border-app-border p-3">
					{request.body.length > 0 ? (
						<div className="border border-app-border bg-app-panel-subtle p-3">
							<CommentBody
								value={request.body}
								ariaLabel={`Change request: ${request.title}`}
								organizationSlug={orgSlug}
								canToggleChecklist={false}
								checklistPending={false}
								onToggleChecklist={ignoreChecklistToggle}
							/>
						</div>
					) : (
						<p className="text-xs text-app-text-muted">
							No details were added to this request.
						</p>
					)}

					{request.decisionNote && (
						<div className="border border-app-border bg-app-panel-subtle p-2 text-xs text-app-text">
							<span className="font-semibold text-app-text-muted uppercase tracking-widest text-[0.6rem]">
								{request.status === "declined"
									? "Declined reason"
									: "Decision note"}
							</span>
							<p className="mt-1 whitespace-pre-wrap">{request.decisionNote}</p>
						</div>
					)}

					{request.status === "moved" &&
						request.targetMilestoneId &&
						request.targetMilestoneTitle && (
							<p className="text-xs text-app-text-muted">
								Moved to{" "}
								<Link
									to="/$orgSlug/projects/$projectSlug/milestones"
									params={{ orgSlug, projectSlug }}
									search={{ milestone: request.targetMilestoneId }}
									className="font-medium text-app-text underline underline-offset-2"
								>
									{request.targetMilestoneTitle}
								</Link>
							</p>
						)}

					{request.scopeEntryId && (
						<div className="flex flex-wrap items-center gap-2 border border-app-border bg-app-panel-subtle p-2 text-xs text-app-text">
							<span className="flex-1">Added to the milestone scope.</span>
							{onOpenScope && (
								<Button
									size="xs"
									variant="outline"
									onPress={() => onOpenScope(request.scopeEntryId)}
								>
									Open scope
								</Button>
							)}
						</div>
					)}

					{!archived &&
						(canDecide || request.canEdit || request.canWithdraw) && (
							<div className="flex flex-wrap items-center gap-2">
								{canDecide && open && (
									<>
										<Button
											size="sm"
											loading={pending}
											onPress={() => onAccept(request)}
										>
											Accept
										</Button>
										<Button
											size="sm"
											variant="outline"
											isDisabled={pending}
											onPress={() => onDecline(request)}
										>
											Decline
										</Button>
										<Button
											size="sm"
											variant="outline"
											isDisabled={pending}
											onPress={() => onMove(request)}
										>
											Move to a new milestone
										</Button>
									</>
								)}

								{request.canEdit && open && (
									<Button
										size="sm"
										variant="ghost"
										isDisabled={pending}
										onPress={() => onEdit(request)}
									>
										Edit
									</Button>
								)}

								{request.canWithdraw && open && (
									<Button
										size="sm"
										variant="ghost"
										isDisabled={pending}
										onPress={() => setConfirmWithdraw(true)}
									>
										Withdraw
									</Button>
								)}
							</div>
						)}

					{!archived && confirmWithdraw && (
						<div className="flex flex-wrap items-center gap-2 border border-danger bg-danger-bg p-2 text-xs text-danger">
							<span className="flex-1">
								Withdraw this request? The client cannot undo it.
							</span>
							<Button
								size="xs"
								variant="destructive"
								loading={pending}
								onPress={() => {
									setConfirmWithdraw(false);
									onWithdraw(request);
								}}
							>
								Yes, withdraw
							</Button>
							<Button
								size="xs"
								variant="ghost"
								isDisabled={pending}
								onPress={() => setConfirmWithdraw(false)}
							>
								Cancel
							</Button>
						</div>
					)}

					{/* The lock no longer blocks accepting: it appends a new section
					    and never rewrites the locked initial scope. */}
				</div>
			)}
		</li>
	);
}
