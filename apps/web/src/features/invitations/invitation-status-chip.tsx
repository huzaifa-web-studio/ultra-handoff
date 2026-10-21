import { Badge } from "@org/ui/components/badge";
import { cn } from "cn";

import type { InvitationStatus } from "./api";

/**
 * Status chip for invitation history.
 *
 * Why: statuses are never colour only. Every chip has a label, and the tone
 * maps to the shared status tokens so light and dark mode stay consistent.
 *
 * Used by: features/invitations/invitations-table.tsx.
 */

const STATUS_STYLES: Record<InvitationStatus, string> = {
	pending: "bg-info-bg text-info",
	expired: "bg-warning-bg text-warning",
	accepted: "bg-success-bg text-success",
	canceled: "bg-neutral-bg text-neutral",
	rejected: "bg-danger-bg text-danger",
};

const STATUS_LABELS: Record<InvitationStatus, string> = {
	pending: "Pending",
	expired: "Expired",
	accepted: "Accepted",
	canceled: "Canceled",
	rejected: "Rejected",
};

export function InvitationStatusChip({
	status,
	className,
}: {
	status: InvitationStatus;
	className?: string;
}) {
	return (
		<Badge className={cn(STATUS_STYLES[status], className)}>
			{STATUS_LABELS[status]}
		</Badge>
	);
}

/** True when the row still has a live or resendable link. */
export function isActionableStatus(status: InvitationStatus): boolean {
	return status === "pending" || status === "expired";
}
