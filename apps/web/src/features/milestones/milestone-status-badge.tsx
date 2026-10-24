/**
 * Milestone status badge.
 *
 * Why one component: the same five states appear in the list row, the detail
 * header and the selects. Keeping the colour mapping in one place means a new
 * status only has to be added once.
 *
 * Used by: milestone-list-item.tsx, milestone-detail-panel.tsx.
 */

import { Badge } from "@org/ui/components/badge";
import { cn } from "cn";

import {
	MILESTONE_STATUS_BADGE_CLASSES,
	MILESTONE_STATUS_ICONS,
} from "./milestone-status-style";
import { MILESTONE_STATUS_LABELS, type MilestoneStatus } from "./schema";

export function MilestoneStatusBadge({
	status,
	className,
}: {
	status: MilestoneStatus;
	className?: string;
}) {
	const Icon = MILESTONE_STATUS_ICONS[status];

	return (
		<Badge
			className={cn(
				"shrink-0",
				MILESTONE_STATUS_BADGE_CLASSES[status],
				className,
			)}
		>
			<Icon aria-hidden />
			{MILESTONE_STATUS_LABELS[status]}
		</Badge>
	);
}
