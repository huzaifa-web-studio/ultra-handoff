"use client";

/**
 * How long a milestone spent in each status.
 *
 * Why its own card: the activity timeline answers "what happened" while this
 * answers "where did the time go". The data comes from the recorded phase
 * periods, so a status change in another tab is reflected on the next refetch.
 *
 * Collapsed by default to keep the Overview calm, with the total and the
 * current phase visible in the header. Expanding shows the totals per status
 * and every period in reverse order.
 *
 * Used by: milestone-detail-panel.tsx.
 */

import { Button } from "@org/ui/components/button";
import { cn } from "cn";
import { ChevronDownIcon, ChevronUpIcon, ClockIcon } from "lucide-react";
import { useState } from "react";
import { formatDate } from "#/lib/date";
import type { MilestonePhase } from "./api";
import { MilestoneStatusBadge } from "./milestone-status-badge";
import { formatDuration } from "./schema";

/** One row in the totals list, in lifecycle order. */
const STATUS_ORDER = [
	"todo",
	"in_development",
	"in_testing",
	"ready",
	"in_review",
	"blocked",
	"done",
	"cancelled",
] as const;

export function MilestonePhaseCard({ phase }: { phase: MilestonePhase }) {
	const [open, setOpen] = useState(false);

	if (phase.periods.length === 0) return null;

	const totalSeconds = Object.values(phase.totals).reduce(
		(sum, value) => sum + value,
		0,
	);
	const current = phase.periods.find((period) => period.exitedAt === null);
	// Newest first: the latest visit is the one a reader is most likely to
	// care about, and the current row sits at the top.
	const periods = [...phase.periods].reverse();

	return (
		<section
			aria-label="Time in phases"
			className="flex flex-col border border-app-border bg-app-panel-subtle"
		>
			<div className="flex items-center justify-between gap-2 px-3 py-2">
				<div className="flex min-w-0 flex-col gap-0.5">
					<span className="flex items-center gap-1.5 text-[0.65rem] font-semibold tracking-widest text-app-text-muted uppercase">
						<ClockIcon className="size-3.5" aria-hidden />
						Time in phases
					</span>
					<span className="text-xs text-app-text">
						{current
							? `${formatDuration(current.durationSeconds)} in this phase`
							: `${formatDuration(totalSeconds)} recorded`}
					</span>
				</div>

				<Button
					size="xs"
					variant="ghost"
					aria-expanded={open}
					onPress={() => setOpen((value) => !value)}
				>
					{open ? (
						<ChevronUpIcon aria-hidden />
					) : (
						<ChevronDownIcon aria-hidden />
					)}
					{open ? "Hide" : "Details"}
				</Button>
			</div>

			{open && (
				<div className="flex flex-col gap-3 border-t border-app-border p-3">
					{/* Totals, only for statuses this milestone actually visited. */}
					<ul className="grid gap-1.5 sm:grid-cols-2">
						{STATUS_ORDER.filter(
							(status) => (phase.totals[status] ?? 0) > 0,
						).map((status) => (
							<li
								key={status}
								className="flex items-center justify-between gap-2 text-xs"
							>
								<MilestoneStatusBadge status={status} />
								<span className="tabular-nums text-app-text">
									{formatDuration(phase.totals[status] ?? 0)}
								</span>
							</li>
						))}
					</ul>

					<ul className="flex flex-col divide-y divide-app-border border-t border-app-border">
						{periods.map((period) => (
							<li
								key={period.id}
								className={cn(
									"flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-1.5 text-xs",
									period.exitedAt === null && "font-medium",
								)}
							>
								<span className="flex min-w-0 items-baseline gap-2">
									<MilestoneStatusBadge status={period.status} />
									<span className="text-app-text-muted">
										{formatDate(period.enteredAt)}
										{period.exitedAt
											? ` to ${formatDate(period.exitedAt)}`
											: " to now"}
									</span>
								</span>
								<span className="tabular-nums text-app-text">
									{formatDuration(period.durationSeconds)}
								</span>
								{period.note && (
									<span className="w-full text-app-text-muted">
										{period.note}
									</span>
								)}
							</li>
						))}
					</ul>
				</div>
			)}
		</section>
	);
}
