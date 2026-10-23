/**
 * Overlapping member avatars for the project header.
 *
 * Why a component: the header needs a compact sense of who is on the project,
 * not the full list. Up to three avatars overlap and the rest collapse into a
 * +N badge.
 *
 * Used by: project-workspace-header.tsx.
 */

import { UserAvatar } from "#/components/user-avatar";
import type { ProjectMemberRow } from "./api";

/** Avatars shown before the +N badge. */
const MEMBER_STACK_MAX = 3;

export function ProjectMemberStack({
	members,
}: {
	members: ProjectMemberRow[];
}) {
	if (members.length === 0) return null;

	const visible = members.slice(0, MEMBER_STACK_MAX);
	const remaining = members.length - visible.length;
	const label = `${members.length} ${members.length === 1 ? "member" : "members"}`;

	return (
		<div className="flex items-center" title={label}>
			<div className="flex -space-x-2" aria-hidden>
				{visible.map((member) => (
					<UserAvatar
						key={member.userId}
						size="sm"
						name={member.name}
						src={member.image}
						className="ring-2 ring-background"
					/>
				))}
				{remaining > 0 && (
					<span className="flex size-6 items-center justify-center rounded-full bg-app-panel-subtle text-xs font-medium text-app-text-muted ring-2 ring-background">
						+{remaining}
					</span>
				)}
			</div>
			<span className="sr-only">{label}</span>
		</div>
	);
}
