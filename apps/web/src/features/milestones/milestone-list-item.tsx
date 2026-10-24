/**
 * One milestone row in the list pane.
 *
 * Why a button: the whole row is the hit target, so a div with a click handler
 * would be a keyboard and screen reader trap. A real button gets Enter, Space
 * and focus for free.
 *
 * The row carries only what a person needs to decide what to open: the title,
 * its state, the due date, the estimate and who owns it. The body lives in the
 * detail pane, not here.
 *
 * Used by: milestone-list-panel.tsx.
 */

import { cn } from "cn";
import { CalendarIcon, ClockIcon } from "lucide-react";
import type * as React from "react";

import type { MilestoneSummary } from "./api";
import { MilestoneAssigneeStack } from "./milestone-assignee-stack";
import { MilestoneStatusBadge } from "./milestone-status-badge";
import { describeDueDate, formatEstimate, isMilestoneOverdue } from "./schema";

export function MilestoneListItem({
	milestone,
	selected,
	onSelect,
	buttonRef,
}: {
	milestone: MilestoneSummary;
	selected: boolean;
	onSelect: () => void;
	buttonRef?: React.Ref<HTMLButtonElement>;
}) {
	const overdue = isMilestoneOverdue(milestone.dueDate, milestone.status);

	return (
		<button
			ref={buttonRef}
			type="button"
			aria-current={selected ? "true" : undefined}
			onClick={onSelect}
			className={cn(
				"flex w-full cursor-pointer flex-col gap-2 border-l-2 px-4 py-3 text-left transition-colors",
				selected
					? "border-app-focus bg-app-selected"
					: "border-transparent hover:bg-app-panel-subtle",
			)}
		>
			<span className="flex items-start justify-between gap-2">
				<span className="line-clamp-2 text-sm font-medium text-app-text">
					{milestone.title}
				</span>
				<MilestoneStatusBadge status={milestone.status} />
			</span>

			<span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-app-text-muted">
				<span
					className={cn(
						"inline-flex items-center gap-1",
						overdue && "font-medium text-danger",
					)}
				>
					<CalendarIcon className="size-3" aria-hidden />
					{describeDueDate(milestone.dueDate, milestone.status)}
				</span>

				{milestone.estimateMinutes !== null && (
					<span className="inline-flex items-center gap-1">
						<ClockIcon className="size-3" aria-hidden />
						{formatEstimate(milestone.estimateMinutes)}
					</span>
				)}

				<span className="ml-auto">
					<MilestoneAssigneeStack assignees={milestone.assignees} />
				</span>
			</span>
		</button>
	);
}
