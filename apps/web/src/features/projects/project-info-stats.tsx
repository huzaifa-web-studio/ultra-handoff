/**
 * Project overview stats.
 *
 * Why a component: the three numbers are the same in every state of the page and
 * keep the overview container focused on composition.
 *
 * Each stat carries an icon next to its label so the three facts are told apart
 * by shape as well as by text.
 *
 * Used by: project-overview.tsx.
 */

import {
	CalendarPlusIcon,
	HistoryIcon,
	type LucideIcon,
	UsersIcon,
} from "lucide-react";

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
			<InfoStat
				icon={CalendarPlusIcon}
				label="Created"
				value={formatDate(project.createdAt)}
			/>
			<InfoStat
				icon={HistoryIcon}
				label="Last updated"
				value={formatDate(project.updatedAt)}
				title={formatDateTime(project.updatedAt)}
			/>
			<InfoStat
				icon={UsersIcon}
				label="Members"
				value={String(memberCount)}
				title={`${memberCount} ${memberCount === 1 ? "person" : "people"}`}
			/>
		</div>
	);
}

/** One small fact about the project. */
function InfoStat({
	icon: Icon,
	label,
	value,
	title,
}: {
	icon: LucideIcon;
	label: string;
	value: string;
	title?: string;
}) {
	return (
		<div className="flex flex-col gap-1 border border-app-border bg-app-panel p-3">
			<span className="flex items-center gap-1.5 text-xs font-semibold tracking-widest text-app-text-muted uppercase">
				<Icon className="size-3.5 shrink-0" aria-hidden />
				{label}
			</span>
			<span className="text-sm font-medium text-app-text" title={title}>
				{value}
			</span>
		</div>
	);
}
