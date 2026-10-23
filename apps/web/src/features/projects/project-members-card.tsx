/**
 * Project members card.
 *
 * Why a component: the overview needs a short preview of the people on the
 * project plus a way into the full members dialog. Keeping it separate means the
 * dialog and the card can evolve together.
 *
 * Used by: project-overview.tsx.
 */

import { Badge } from "@org/ui/components/badge";
import { Button } from "@org/ui/components/button";

import { UserAvatar } from "#/components/user-avatar";
import type { ProjectMemberRow } from "./api";
import { ProjectRoleChip } from "./project-role-chip";

/** Members shown before the card points at the full list. */
const MEMBER_PREVIEW_MAX = 6;

export function ProjectMembersCard({
	members,
	canManage,
	onManage,
}: {
	members: ProjectMemberRow[];
	canManage: boolean;
	onManage: () => void;
}) {
	const previewMembers = members.slice(0, MEMBER_PREVIEW_MAX);

	return (
		<section className="flex flex-col border border-app-border bg-app-panel">
			<div className="flex flex-wrap items-center justify-between gap-2 border-b border-app-border p-4">
				<div className="flex items-center gap-2">
					<h2 className="text-sm font-semibold text-app-text">Members</h2>
					<Badge className="bg-neutral-bg text-neutral">{members.length}</Badge>
				</div>
				{canManage && (
					<Button variant="ghost" onPress={onManage}>
						Manage
					</Button>
				)}
			</div>

			{previewMembers.length === 0 ? (
				<p className="p-4 text-sm text-app-text-muted">
					Nobody has been added to this project yet.
				</p>
			) : (
				<ul className="divide-y divide-app-border">
					{previewMembers.map((member) => (
						<li
							key={member.userId}
							className="flex flex-wrap items-center justify-between gap-3 p-3"
						>
							<div className="flex min-w-0 items-center gap-2.5">
								<UserAvatar size="sm" name={member.name} src={member.image} />
								<div className="flex min-w-0 flex-col">
									<span className="truncate text-sm font-medium text-app-text">
										{member.name}
										{member.isSelf && (
											<span className="text-app-text-muted"> (you)</span>
										)}
									</span>
									<span className="truncate text-xs text-app-text-muted">
										{member.email}
									</span>
								</div>
							</div>
							<ProjectRoleChip role={member.role} />
						</li>
					))}
				</ul>
			)}

			{members.length > previewMembers.length && (
				<div className="border-t border-app-border p-3">
					<Button variant="ghost" onPress={onManage}>
						Show all {members.length} members
					</Button>
				</div>
			)}
		</section>
	);
}
