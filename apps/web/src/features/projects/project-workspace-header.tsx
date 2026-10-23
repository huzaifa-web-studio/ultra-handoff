/**
 * Project workspace header.
 *
 * Why a component: every project tab renders the same identity, description,
 * member stack and pin action. Keeping it out of the layout lets the layout
 * deal with data and routing instead of markup.
 *
 * The header intentionally carries only the identity and the pin action. Project
 * edits and member management belong to the tabs.
 *
 * Used by: project-workspace.tsx.
 */

import { Button } from "@org/ui/components/button";
import { Link } from "@tanstack/react-router";
import {
	ArchiveRestoreIcon,
	ArrowLeftIcon,
	PinIcon,
	PinOffIcon,
} from "lucide-react";

import { UserAvatar } from "#/components/user-avatar";
import type { ProjectMemberRow, ProjectRow } from "./api";
import { ProjectMemberStack } from "./project-member-stack";
import { ProjectRoleChip } from "./project-role-chip";
import { ProjectStatusBadge } from "./project-status-badge";

type ProjectWorkspaceHeaderProps = {
	orgSlug: string;
	project: ProjectRow;
	members: ProjectMemberRow[];
	archived: boolean;
	isPinning: boolean;
	onTogglePin: () => void;
	/** Restore is only offered to a caller who may edit the project. */
	canRestore: boolean;
	isRestoring: boolean;
	onRestore: () => void;
};

export function ProjectWorkspaceHeader({
	orgSlug,
	project,
	members,
	archived,
	isPinning,
	onTogglePin,
	canRestore,
	isRestoring,
	onRestore,
}: ProjectWorkspaceHeaderProps) {
	return (
		<>
			<Link
				to="/$orgSlug/projects"
				params={{ orgSlug }}
				className="inline-flex w-fit items-center gap-1.5 text-sm text-app-text-muted hover:text-app-text"
			>
				<ArrowLeftIcon className="size-4" aria-hidden />
				All projects
			</Link>

			<header className="flex flex-col gap-3">
				<div className="flex flex-wrap items-start justify-between gap-4">
					<div className="flex min-w-0 items-start gap-3">
						<UserAvatar
							size="lg"
							shape="square"
							name={project.name}
							src={project.logo}
						/>
						<div className="flex min-w-0 flex-col gap-1.5">
							<div className="flex flex-wrap items-center gap-2">
								<h1 className="text-2xl font-bold text-app-text">
									{project.name}
								</h1>
								<ProjectStatusBadge status={project.status} />
								<ProjectRoleChip role={project.myRole} />
							</div>
							<p className="text-sm text-app-text-muted">/{project.slug}</p>
						</div>
					</div>

					<div className="flex flex-wrap items-center gap-3">
						<ProjectMemberStack members={members} />
						<Button
							variant="outline"
							isDisabled={isPinning || (archived && !project.pinned)}
							onPress={onTogglePin}
						>
							{project.pinned ? (
								<PinOffIcon aria-hidden />
							) : (
								<PinIcon aria-hidden />
							)}
							{project.pinned ? "Unpin" : "Pin"}
						</Button>
					</div>
				</div>

				<p className="max-w-3xl text-app-text-muted">
					{project.description || "No description yet."}
				</p>

				{archived && (
					<div className="flex flex-wrap items-center justify-between gap-3 border border-warning bg-warning-bg p-3">
						<p className="text-sm text-app-text">
							This project is archived and read-only. Restore it to make
							changes, manage members or edit its settings.
						</p>
						{canRestore && (
							<Button
								variant="outline"
								isDisabled={isRestoring}
								onPress={onRestore}
							>
								<ArchiveRestoreIcon aria-hidden />
								Restore project
							</Button>
						)}
					</div>
				)}
			</header>
		</>
	);
}
