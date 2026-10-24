/**
 * Assignee avatars for a milestone.
 *
 * Why a stack: a milestone can have several assignees, but a list row only has
 * room for a hint. Three avatars and a `+N` is enough to recognise the people
 * at a glance, and the full list is available in the title attribute and in the
 * detail pane.
 *
 * Used by: milestone-list-item.tsx.
 */

import { cn } from "cn";

import { UserAvatar } from "#/components/user-avatar";
import type { MilestoneAssignee } from "./api";

/** How many avatars fit before the overflow counter takes over. */
const VISIBLE_MAX = 3;

export function MilestoneAssigneeStack({
	assignees,
	className,
}: {
	assignees: MilestoneAssignee[];
	className?: string;
}) {
	if (assignees.length === 0) {
		return (
			<span className={cn("text-xs text-app-text-muted", className)}>
				Unassigned
			</span>
		);
	}

	const visible = assignees.slice(0, VISIBLE_MAX);
	const overflow = assignees.length - visible.length;

	return (
		<span
			className={cn("flex items-center", className)}
			title={assignees.map((assignee) => assignee.name).join(", ")}
		>
			{visible.map((assignee, index) => (
				<UserAvatar
					key={assignee.userId}
					size="sm"
					name={assignee.name}
					src={assignee.image}
					className={cn(
						"size-5 border border-app-panel",
						index > 0 && "-ml-1.5",
					)}
				/>
			))}
			{overflow > 0 && (
				<span className="-ml-1.5 flex size-5 items-center justify-center border border-app-panel bg-app-panel-subtle text-[0.6rem] font-semibold text-app-text-muted">
					+{overflow}
				</span>
			)}
			<span className="sr-only">
				Assigned to {assignees.map((assignee) => assignee.name).join(", ")}
			</span>
		</span>
	);
}
