/**
 * One change request status chip.
 *
 * Why a module: the same five states appear in the list row and the detail.
 * Keeping the class map in one place means a new status, or a shade change in
 * the shared tokens, only touches this file.
 *
 * Used by: changes-tab.tsx and change-request-item.tsx.
 */

import { Badge } from "@org/ui/components/badge";
import { cn } from "cn";

import type { ChangeRequestStatus } from "./api";

/** Status to label. Mirrors the API vocabulary. */
export const CHANGE_REQUEST_STATUS_LABELS: Record<ChangeRequestStatus, string> =
	{
		open: "Open",
		accepted: "Accepted",
		declined: "Declined",
		moved: "Moved",
		withdrawn: "Withdrawn",
	};

/** Status to token classes. Every value uses a semantic status token. */
const STATUS_CLASSES: Record<ChangeRequestStatus, string> = {
	open: "bg-info-bg text-info",
	accepted: "bg-success-bg text-success",
	declined: "bg-danger-bg text-danger",
	moved: "bg-neutral-bg text-neutral",
	withdrawn: "bg-neutral-bg text-neutral line-through",
};

export function ChangeRequestStatusChip({
	status,
	className,
}: {
	status: ChangeRequestStatus;
	className?: string;
}) {
	return (
		<Badge className={cn("shrink-0", STATUS_CLASSES[status], className)}>
			{CHANGE_REQUEST_STATUS_LABELS[status]}
		</Badge>
	);
}
