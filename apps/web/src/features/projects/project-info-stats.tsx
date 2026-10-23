/**
 * Project overview stats.
 *
 * Why a component: the three numbers are the same in every state of the page and
 * keep the overview container focused on composition.
 *
 * Used by: project-overview.tsx.
 */

import { formatDate, formatDateTime } from "#/lib/date";
import type { ProjectRow } from "./api";

export function ProjectInfoStats({
	project,
	memberCount,
}: {
	project: ProjectRow;
	memberCount: number;
}) {
	return (
		<div className="grid gap-4 sm:grid-cols-3">
			<InfoStat label="Created" value={formatDate(project.createdAt)} />
			<InfoStat
				label="Last updated"
				value={formatDate(project.updatedAt)}
				title={formatDateTime(project.updatedAt)}
			/>
			<InfoStat
				label="Members"
				value={String(memberCount)}
				title={`${memberCount} ${memberCount === 1 ? "person" : "people"}`}
			/>
		</div>
	);
}

/** One small fact about the project. */
function InfoStat({
	label,
	value,
	title,
}: {
	label: string;
	value: string;
	title?: string;
}) {
	return (
		<div className="flex flex-col gap-1 border border-app-border bg-app-panel p-3">
			<span className="text-xs font-semibold tracking-widest text-app-text-muted uppercase">
				{label}
			</span>
			<span className="text-sm font-medium text-app-text" title={title}>
				{value}
			</span>
		</div>
	);
}
