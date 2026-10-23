/**
 * Projects page summary strip.
 *
 * Why a component: the table page needs a quick count of active, archived and
 * total projects above the filters. Keeping it here leaves the page component
 * focused on state and layout.
 *
 * Used by: projects-page.tsx.
 */

import type { ProjectsResponse } from "./api";

export function ProjectsSummary({
	counts,
}: {
	counts: ProjectsResponse["counts"];
}) {
	return (
		<div className="grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-3">
			<SummaryStat label="Active" value={String(counts.active)} />
			<SummaryStat label="Archived" value={String(counts.archived)} />
			<SummaryStat label="Total" value={String(counts.all)} />
		</div>
	);
}

/** One number in the summary strip. */
function SummaryStat({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex flex-col gap-1 border border-app-border bg-app-panel p-3">
			<span className="text-xs font-semibold tracking-widest text-app-text-muted uppercase">
				{label}
			</span>
			<span className="text-lg font-bold text-app-text">{value}</span>
		</div>
	);
}
