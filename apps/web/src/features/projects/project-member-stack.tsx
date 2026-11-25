/**
 * Overlapping member avatars for the project header.
 *
 * Why a component: the header needs a compact sense of who is on the project,
 * not the full list. Up to three avatars overlap and the rest collapse into a
 * +N badge.
 *
 * Used by: project-workspace-header.tsx.
 */

import { MemberAvatar } from "#/components/member-hover-card";
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
			{/*
			 * No `aria-hidden` here. Each avatar is a link to a profile now, so
			 * hiding the group would remove three real controls from the
			 * accessibility tree. The group label keeps the count available.
			 */}
			<fieldset
				className="m-0 flex min-w-0 -space-x-2 border-0 p-0"
				aria-label={label}
			>
				{visible.map((member) => (
					<MemberAvatar
						key={member.userId}
						userId={member.userId}
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
			</fieldset>
		</div>
	);
}
