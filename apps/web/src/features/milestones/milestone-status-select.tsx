/**
 * Milestone status select.
 *
 * Why a select over a row of chips: the status is one value with five options,
 * and a select keeps the detail header compact. The value saves immediately, so
 * there is no separate save button to forget.
 *
 * The options reuse the badge icon family so the selected value matches what the
 * list row shows for the same milestone.
 *
 * Used by: milestone-detail-panel.tsx.
 */

import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@org/ui/components/select";
import { cn } from "cn";

import {
	MILESTONE_STATUS_ICONS,
	milestoneStatusTextClass,
} from "./milestone-status-style";
import {
	MILESTONE_STATUS_LABELS,
	MILESTONE_STATUSES,
	type MilestoneStatus,
} from "./schema";

export function MilestoneStatusSelect({
	status,
	onChange,
	readOnly = false,
}: {
	status: MilestoneStatus;
	onChange: (next: MilestoneStatus) => void;
	readOnly?: boolean;
}) {
	if (readOnly) {
		const Icon = MILESTONE_STATUS_ICONS[status];

		return (
			<span className="inline-flex items-center gap-2 text-sm text-app-text">
				<Icon className="size-3.5 shrink-0" aria-hidden />
				{MILESTONE_STATUS_LABELS[status]}
			</span>
		);
	}

	return (
		<Select
			aria-label="Milestone status"
			selectedKey={status}
			// Full width in both places it appears: the create dialog grid and
			// the detail metadata column. The trigger alone cannot do this
			// because the Select root defaults to `w-fit`.
			className="w-full"
			onSelectionChange={(key) => {
				if (typeof key === "string") onChange(key as MilestoneStatus);
			}}
		>
			<SelectTrigger size="sm" className="w-full">
				<SelectValue>
					{() => {
						const Icon = MILESTONE_STATUS_ICONS[status];

						return (
							<span
								className={cn(
									"inline-flex items-center gap-2",
									milestoneStatusTextClass(status),
								)}
							>
								<Icon className="size-3.5 shrink-0" aria-hidden />
								{MILESTONE_STATUS_LABELS[status]}
							</span>
						);
					}}
				</SelectValue>
			</SelectTrigger>
			<SelectContent className="min-w-40">
				{MILESTONE_STATUSES.map((option) => {
					const Icon = MILESTONE_STATUS_ICONS[option];

					return (
						<SelectItem
							key={option}
							id={option}
							textValue={MILESTONE_STATUS_LABELS[option]}
						>
							<span
								className={cn(
									"inline-flex items-center gap-2",
									milestoneStatusTextClass(option),
								)}
							>
								<Icon className="size-3.5 shrink-0" aria-hidden />
								{MILESTONE_STATUS_LABELS[option]}
							</span>
						</SelectItem>
					);
				})}
			</SelectContent>
		</Select>
	);
}
