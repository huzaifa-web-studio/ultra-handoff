"use client";

/**
 * The milestone detail header.
 *
 * Why this file: the title field, the save-on-blur behaviour, the lock badge and
 * the row actions are one self-contained block. Keeping them out of the content
 * component means the content component is about tabs and drafts.
 *
 * Used by: `milestone-detail-panel.tsx`.
 */

import { Button } from "@org/ui/components/button";
import { Input } from "@org/ui/components/input";
import { LockIcon, LockOpenIcon, Trash2Icon, XIcon } from "lucide-react";
import { formatDate, formatRelativeTime } from "#/lib/date";
import type { MilestoneDetail, MilestoneViewer } from "../api";
import { MilestoneStatusBadge } from "../milestone-status-badge";
import { MILESTONE_TITLE_MAX, type MilestoneStatus } from "../schema";

/** A debounced saver, as returned by `useDebouncedCallback`. */
type DebouncedSaver = {
	schedule: (value: string) => void;
	flush: () => void;
};

/** A mutable ref, kept structural so the component does not import React types. */
type Mutable<T> = { current: T };

export function MilestoneDetailHeader({
	canEditFields,
	title,
	setTitle,
	saveTitle,
	titleFocused,
	lastSavedTitle,
	milestone,
	status,
	locked,
	viewer,
	lockPending,
	onToggleLock,
	onDelete,
	onClose,
}: {
	canEditFields: boolean;
	title: string;
	setTitle: (value: string) => void;
	saveTitle: DebouncedSaver;
	titleFocused: Mutable<boolean>;
	lastSavedTitle: Mutable<string>;
	milestone: MilestoneDetail;
	status: MilestoneStatus;
	locked: boolean;
	viewer: MilestoneViewer;
	lockPending: boolean;
	onToggleLock: () => void;
	onDelete: () => void;
	onClose?: () => void;
}) {
	return (
		<>
			<header className="flex items-start gap-2 border-b border-app-border p-4">
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					{canEditFields ? (
						<Input
							value={title}
							maxLength={MILESTONE_TITLE_MAX}
							aria-label="Milestone title"
							onChange={(event) => {
								setTitle(event.target.value);
								saveTitle.schedule(event.target.value);
							}}
							onFocus={() => {
								titleFocused.current = true;
							}}
							onBlur={() => {
								titleFocused.current = false;

								// An empty title is never saved, so the field must snap
								// back instead of showing a value the server does not have.
								if (title.trim().length === 0) {
									setTitle(lastSavedTitle.current);
									return;
								}

								saveTitle.flush();
							}}
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									event.preventDefault();
									saveTitle.flush();
								}
							}}
							className="h-auto border-b-transparent px-0 py-0 font-display text-xl font-bold tracking-normal normal-case focus-visible:border-b-app-focus"
						/>
					) : (
						<h2 className="font-display text-xl font-bold text-app-text">
							{milestone.title}
						</h2>
					)}

					<div className="flex flex-wrap items-center gap-2 text-xs text-app-text-muted">
						<MilestoneStatusBadge status={status} />
						{locked && (
							<span className="inline-flex items-center gap-1 bg-app-selected px-1.5 py-0.5 font-semibold text-app-text uppercase tracking-widest text-[0.6rem]">
								<LockIcon className="size-3" aria-hidden />
								Locked
							</span>
						)}
						{milestone.updatedByName && (
							<span>
								Edited {formatRelativeTime(milestone.updatedAt)} by{" "}
								{milestone.updatedByName}
							</span>
						)}
						{milestone.completedAt && (
							<span>Completed {formatRelativeTime(milestone.completedAt)}</span>
						)}
					</div>
				</div>

				<div className="flex shrink-0 items-center gap-1">
					{viewer.canLock && (
						<Button
							variant="ghost"
							size="sm"
							loading={lockPending}
							onPress={onToggleLock}
						>
							{locked ? <LockOpenIcon aria-hidden /> : <LockIcon aria-hidden />}
							{locked ? "Unlock" : "Lock"}
						</Button>
					)}
					{canEditFields && (
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Delete milestone"
							onPress={onDelete}
						>
							<Trash2Icon aria-hidden />
						</Button>
					)}
					{onClose && (
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Close milestone details"
							onPress={onClose}
						>
							<XIcon aria-hidden />
						</Button>
					)}
				</div>
			</header>

			{locked && (
				<div className="flex flex-wrap items-center gap-2 border-b border-warning bg-warning-bg px-4 py-2 text-xs text-warning">
					<LockIcon className="size-3.5 shrink-0" aria-hidden />
					<span>
						Locked by {milestone.lockedByName ?? "an owner"} on{" "}
						{formatDate(milestone.lockedAt ?? milestone.updatedAt)}. The initial
						scope, title, dates and estimate are read-only. Status, assignees,
						checklist progress and active phase notes can still change, and a
						change request can still be accepted into a new section.
					</span>
				</div>
			)}
		</>
	);
}
