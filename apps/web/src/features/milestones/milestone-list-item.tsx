/**
 * One milestone row in the list pane.
 *
 * Why a container with two controls instead of one button: the row selects the
 * milestone, and its status badge is also a control. A button cannot be nested
 * inside a button, so the row is a plain container with a real selection button
 * and a sibling status picker. Both stay keyboard reachable, and neither steals
 * the other's press.
 *
 * The selection button carries only what a person needs to decide what to open:
 * the title, its due date, the estimate and who owns it. The body lives in the
 * detail pane, not here.
 *
 * Used by: milestone-list-panel.tsx.
 */

import { cn } from "cn";
import { CalendarIcon, ClockIcon } from "lucide-react";
import type * as React from "react";

import type { MilestoneSummary } from "./api";
import { MilestoneAssigneeStack } from "./milestone-assignee-stack";
import { MilestoneStatusSelect } from "./milestone-status-select";
import {
	describeDueDate,
	formatEstimate,
	isMilestoneOverdue,
	type MilestoneStatus,
} from "./schema";

export function MilestoneListItem({
	milestone,
	selected,
	onSelect,
	onChangeStatus,
	canWrite,
	isStatusPending,
	buttonRef,
}: {
	milestone: MilestoneSummary;
	selected: boolean;
	onSelect: () => void;
	onChangeStatus: (status: MilestoneStatus) => void;
	/** Read only viewers keep the badge as a label, with no picker. */
	canWrite: boolean;
	/** True while this row's status request is in flight. */
	isStatusPending: boolean;
	buttonRef?: React.Ref<HTMLButtonElement>;
}) {
	const overdue = isMilestoneOverdue(milestone.dueDate, milestone.status);

	return (
		<div
			className={cn(
				"relative border-l-2 transition-colors",
				selected
					? "border-app-focus bg-app-selected"
					: "border-transparent hover:bg-app-panel-subtle",
			)}
		>
			<button
				ref={buttonRef}
				type="button"
				aria-current={selected ? "true" : undefined}
				onClick={onSelect}
				className="flex w-full cursor-pointer flex-col gap-2 px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
			>
				{/* The right padding keeps the title clear of the status control. */}
				<span className="line-clamp-2 pr-32 text-sm font-medium text-app-text">
					{milestone.title}
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

			<div className="absolute top-2.5 right-3">
				<MilestoneStatusSelect
					status={milestone.status}
					onChange={onChangeStatus}
					readOnly={!canWrite}
					variant="badge"
					isDisabled={isStatusPending}
				/>
			</div>
		</div>
	);
}
