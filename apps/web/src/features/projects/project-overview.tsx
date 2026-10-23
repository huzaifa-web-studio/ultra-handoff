/**
 * Project overview tab.
 *
 * Why a feature component: the route file only resolves params. This component
 * owns the overview query, the members dialog state and the composition of the
 * stats, members card and placeholder.
 *
 * Used by: routes/_app/$orgSlug.projects.$projectSlug.index.tsx.
 */

import { useState } from "react";

import { useProjectDetailBySlug } from "./hooks";
import { ProjectInfoStats } from "./project-info-stats";
import { ProjectMembersCard } from "./project-members-card";
import { ProjectMembersDialog } from "./project-members-dialog";
import { ProjectOverviewSkeleton } from "./project-overview-skeleton";

export function ProjectOverview({
	orgSlug,
	projectSlug,
}: {
	orgSlug: string;
	projectSlug: string;
}) {
	const query = useProjectDetailBySlug(orgSlug, projectSlug);
	const [membersOpen, setMembersOpen] = useState(false);

	// The layout gates the Outlet on the same query, so this is normally already
	// cached. The fallback keeps a direct render from flashing empty.
	if (query.isPending) {
		return <ProjectOverviewSkeleton />;
	}

	if (!query.data) return null;

	const { project, members, viewer } = query.data;

	return (
		<div className="flex w-full flex-col gap-6">
			<ProjectInfoStats project={project} memberCount={members.length} />

			<ProjectMembersCard
				members={members}
				canManage={viewer.canManageMembers}
				onManage={() => setMembersOpen(true)}
			/>

			<section className="flex flex-col items-center justify-center gap-2 border border-app-border bg-app-panel p-12 text-center">
				<h2 className="text-lg font-bold text-app-text">
					Scope and deliveries
				</h2>
				<p className="max-w-md text-sm text-app-text-muted">
					The agreed scope, submitted deliverables and client approvals will
					appear here.
				</p>
				<span className="text-xs font-semibold tracking-widest text-app-text-muted uppercase">
					Coming soon
				</span>
			</section>

			<ProjectMembersDialog
				orgSlug={orgSlug}
				project={project}
				isOpen={membersOpen}
				onOpenChange={setMembersOpen}
			/>
		</div>
	);
}
