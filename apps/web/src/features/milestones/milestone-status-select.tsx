/**
 * Milestone status select.
 *
 * Why a select over a row of chips: the status is one value with five options,
 * and a select keeps the detail header compact. The value saves immediately, so
 * there is no separate save button to forget.
 *
 * Two variants share the same options and icons: `field` is the labelled control
 * in the detail pane and the create dialog, `badge` turns the list row's status
 * badge into the same picker so the list can change a status without opening the
 * milestone.
 *
 * Used by: milestone-detail-panel.tsx, milestone-create-dialog.tsx,
 * milestone-list-item.tsx.
 */

import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@org/ui/components/select";
import { cn } from "cn";

import { MilestoneStatusBadge } from "./milestone-status-badge";
import {
	MILESTONE_STATUS_BADGE_CLASSES,
	MILESTONE_STATUS_ICONS,
	milestoneStatusTextClass,
} from "./milestone-status-style";
import {
	MILESTONE_STATUS_LABELS,
	MILESTONE_STATUSES,
	type MilestoneStatus,
} from "./schema";

/** The icon and label for one status, shared by both trigger variants. */
function StatusLabel({
	status,
	className,
}: {
	status: MilestoneStatus;
	className?: string;
}) {
	const Icon = MILESTONE_STATUS_ICONS[status];

	return (
		<span className={cn("inline-flex items-center gap-1.5", className)}>
			<Icon className="size-3.5 shrink-0" aria-hidden />
			{MILESTONE_STATUS_LABELS[status]}
		</span>
	);
}

export function MilestoneStatusSelect({
	status,
	onChange,
	readOnly = false,
	variant = "field",
	isDisabled = false,
}: {
	status: MilestoneStatus;
	onChange: (next: MilestoneStatus) => void;
	readOnly?: boolean;
	variant?: "field" | "badge";
	isDisabled?: boolean;
}) {
	if (readOnly) {
		if (variant === "badge") {
			return <MilestoneStatusBadge status={status} />;
		}

		return (
			<span className="inline-flex items-center gap-2 text-sm text-app-text">
				<StatusLabel status={status} />
			</span>
		);
	}

	const label = MILESTONE_STATUS_LABELS[status];

	return (
		<Select
			aria-label={
				variant === "badge"
					? `Status: ${label}. Change status`
					: "Milestone status"
			}
			selectedKey={status}
			isDisabled={isDisabled}
			// Full width in both places it appears: the create dialog grid and
			// the detail metadata column. The trigger alone cannot do this
			// because the Select root defaults to `w-fit`.
			className={variant === "badge" ? "w-fit" : "w-full"}
			onSelectionChange={(key) => {
				if (typeof key === "string") onChange(key as MilestoneStatus);
			}}
		>
			{variant === "badge" ? (
				/*
				 * A badge shaped trigger. The base trigger's height, padding and
				 * bottom border are overridden so it reads as the same badge the
				 * row used to show, plus the chevron the trigger adds.
				 */
				<SelectTrigger
					size="sm"
					className={cn(
						"h-auto w-fit gap-1 border-0 px-2 py-0.5 text-[0.625rem] font-semibold tracking-widest uppercase",
						"data-[size=sm]:h-auto data-[size=sm]:px-2 data-[size=sm]:py-0.5",
						"hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/30",
						"[&_svg]:size-3! [&>svg]:text-current",
						MILESTONE_STATUS_BADGE_CLASSES[status],
					)}
				>
					<SelectValue>{() => <StatusLabel status={status} />}</SelectValue>
				</SelectTrigger>
			) : (
				<SelectTrigger size="sm" className="w-full">
					<SelectValue>
						{() => (
							<StatusLabel
								status={status}
								className={milestoneStatusTextClass(status)}
							/>
						)}
					</SelectValue>
				</SelectTrigger>
			)}
			<SelectContent className="min-w-40">
				{MILESTONE_STATUSES.map((option) => (
					<SelectItem
						key={option}
						id={option}
						textValue={MILESTONE_STATUS_LABELS[option]}
					>
						<StatusLabel
							status={option}
							className={milestoneStatusTextClass(option)}
						/>
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
