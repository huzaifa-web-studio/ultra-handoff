/**
 * Projects the profile owner belongs to.
 *
 * Why a card instead of the projects table: a profile is a summary. Rows are
 * read only links, with the role that person holds and an archived hint, so the
 * viewer can jump into the project without leaving the flow they were in.
 *
 * Used by: features/people/profile-page.tsx.
 */

import { Badge } from "@org/ui/components/badge";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@org/ui/components/card";
import { Link } from "@tanstack/react-router";
import { FolderIcon } from "lucide-react";

import { UserAvatar } from "#/components/user-avatar";
import { ProjectRoleChip } from "#/features/projects/project-role-chip";
import type { MemberProfileProject } from "./api";

export function ProfileProjects({
	orgSlug,
	projects,
}: {
	orgSlug: string;
	projects: MemberProfileProject[];
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					Projects
					<span className="text-sm font-normal text-app-text-muted">
						{projects.length}
					</span>
				</CardTitle>
			</CardHeader>

			<CardContent>
				{projects.length === 0 ? (
					<div className="flex flex-col items-center gap-2 py-6 text-center">
						<FolderIcon aria-hidden className="size-6 text-app-text-muted" />
						<p className="text-sm text-app-text-muted">
							No shared projects yet.
						</p>
					</div>
				) : (
					<ul className="flex flex-col divide-y divide-app-border">
						{projects.map((project) => (
							<li key={project.id}>
								<Link
									to="/$orgSlug/projects/$projectSlug"
									params={{ orgSlug, projectSlug: project.slug }}
									className="flex items-center gap-3 py-3 hover:bg-app-panel-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-focus"
								>
									<UserAvatar
										shape="square"
										size="lg"
										src={project.logo}
										name={project.name}
									/>
									<div className="min-w-0 flex-1">
										<p className="truncate text-sm font-medium text-app-text">
											{project.name}
										</p>
										<p className="truncate text-xs text-app-text-muted">
											{project.slug}
										</p>
									</div>
									{project.archived && (
										<Badge className="bg-neutral-bg text-neutral">
											Archived
										</Badge>
									)}
									<ProjectRoleChip role={project.role} />
								</Link>
							</li>
						))}
					</ul>
				)}
			</CardContent>
		</Card>
	);
}
