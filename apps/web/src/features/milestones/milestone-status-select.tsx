/**
 * Milestone status select.
 *
 * Why a select over a row of chips: the status is one value with five options,
 * and a select keeps the detail header compact. The value saves immediately, so
 * there is no separate save button to forget.
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
		return (
			<span className="text-sm text-app-text">
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
				<SelectValue />
			</SelectTrigger>
			<SelectContent className="min-w-40">
				{MILESTONE_STATUSES.map((option) => (
					<SelectItem key={option} id={option}>
						{MILESTONE_STATUS_LABELS[option]}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
