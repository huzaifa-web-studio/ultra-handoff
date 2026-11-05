"use client";

/**
 * A milestone activity entry inside the comment timeline.
 *
 * Why a centered, dashed card instead of a comment bubble: this is not a
 * message. It records that somebody changed the status, start date or due date.
 * Giving it the same avatar, author header and action row as a comment would
 * invite replies and edits that do not exist. The centered rule and dashed
 * border make it read as a system event between the conversations around it.
 *
 * Used by: comments/comment-tab.tsx.
 */

import {
	CalendarClockIcon,
	CalendarDaysIcon,
	RefreshCwIcon,
} from "lucide-react";

import { formatDate, formatDateTime, formatRelativeTime } from "#/lib/date";
import { MilestoneStatusBadge } from "../milestone-status-badge";
import type { MilestoneStatus } from "../schema";
import type { Comment } from "./api";

/** The icon for one event type. */
function EventIcon({ type }: { type: "status" | "start_date" | "due_date" }) {
	if (type === "status") {
		return <RefreshCwIcon className="size-3.5" aria-hidden />;
	}

	if (type === "start_date") {
		return <CalendarClockIcon className="size-3.5" aria-hidden />;
	}

	return <CalendarDaysIcon className="size-3.5" aria-hidden />;
}

/** Format a stored day as day month year. Null reads as "not set". */
function dayLabel(value: string | Date | null): string {
	if (!value) return "not set";

	// Eden turns ISO-looking strings into Date objects on the client. The API
	// stores a day, but either shape can arrive here, and both render the same.
	if (value instanceof Date) return formatDate(value);

	return formatDate(value.length > 10 ? value : `${value}T00:00:00`);
}

/** Build the sentence for one event. */
function describeEvent(event: Comment) {
	const data = event.event;

	if (!data) return null;

	const from = dayLabel(data.from);
	const to = dayLabel(data.to);

	if (data.type === "status") {
		return {
			before: "changed the status from",
			from: (
				<MilestoneStatusBadge
					status={data.from as MilestoneStatus}
					className="mx-1 align-middle"
				/>
			),
			after: "to",
			to: (
				<MilestoneStatusBadge
					status={data.to as MilestoneStatus}
					className="mx-1 align-middle"
				/>
			),
		};
	}

	const label = data.type === "start_date" ? "start date" : "due date";

	if (!data.from) {
		return { before: `set the ${label} to`, from: null, after: "", to };
	}

	if (!data.to) {
		return {
			before: `cleared the ${label}, it was`,
			from,
			after: "",
			to: null,
		};
	}

	return { before: `changed the ${label} from`, from, after: "to", to };
}

export function MilestoneEventItem({ event }: { event: Comment }) {
	if (event.kind !== "event" || !event.event) return null;

	const data = event.event;
	const actor = event.author?.name ?? "Someone";
	const sentence = describeEvent(event);

	if (!sentence) return null;

	return (
		<li
			className="flex items-center gap-3 py-1"
			aria-label="Milestone activity"
		>
			<span aria-hidden className="h-px flex-1 bg-app-border" />

			<div className="flex max-w-lg items-center gap-2.5 border border-dashed border-app-border-strong bg-app-panel px-3 py-2 text-xs text-app-text-muted">
				<span className="flex size-6 shrink-0 items-center justify-center border border-app-border bg-app-selected text-app-text">
					<EventIcon type={data.type} />
				</span>

				<div className="flex min-w-0 flex-col gap-0.5">
					<p className="flex flex-wrap items-center gap-y-1 text-app-text">
						<span className="font-medium">{actor}</span>
						<span className="mx-1">{sentence.before}</span>
						{typeof sentence.from === "string" ? (
							<span className="font-medium">{sentence.from}</span>
						) : (
							sentence.from
						)}
						{sentence.after && <span className="mx-1">{sentence.after}</span>}
						{typeof sentence.to === "string" ? (
							<span className="font-medium">{sentence.to}</span>
						) : (
							sentence.to
						)}
					</p>

					<time
						dateTime={event.createdAt}
						title={formatDateTime(event.createdAt)}
						className="text-[0.65rem] text-app-text-muted"
					>
						{formatRelativeTime(event.createdAt)}
					</time>
				</div>
			</div>

			<span aria-hidden className="h-px flex-1 bg-app-border" />
		</li>
	);
}
