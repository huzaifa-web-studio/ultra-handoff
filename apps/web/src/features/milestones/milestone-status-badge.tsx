/**
 * Milestone status badge.
 *
 * Why one component: the same five states appear in the list row, the detail
 * header and the filter chips. Keeping the colour mapping in one place means a
 * new status only has to be added once.
 *
 * Used by: milestone-list-item.tsx, milestone-detail-panel.tsx.
 */

import { Badge } from "@org/ui/components/badge";
import { cn } from "cn";

import { MILESTONE_STATUS_LABELS, type MilestoneStatus } from "./schema";

/**
 * Token classes per status.
 *
 * Only existing status tokens are used, so both themes keep AA contrast without
 * a second colour scale.
 */
const STATUS_CLASSES: Record<MilestoneStatus, string> = {
	todo: "bg-neutral-bg text-neutral",
	in_progress: "bg-info-bg text-info",
	blocked: "bg-danger-bg text-danger",
	done: "bg-success-bg text-success",
	cancelled: "bg-neutral-bg text-app-text-muted line-through",
};

export function MilestoneStatusBadge({
	status,
	className,
}: {
	status: MilestoneStatus;
	className?: string;
}) {
	return (
		<Badge className={cn("shrink-0", STATUS_CLASSES[status], className)}>
			{MILESTONE_STATUS_LABELS[status]}
		</Badge>
	);
}
