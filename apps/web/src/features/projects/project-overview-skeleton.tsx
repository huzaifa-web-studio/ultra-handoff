/**
 * Project overview loading shape.
 *
 * Why a component: the overview renders this while its query resolves, and the
 * shape matches the stats, members card and placeholder so the page does not
 * jump when data lands.
 *
 * Used by: project-overview.tsx.
 */

import { Skeleton } from "@org/ui/components/skeleton";

export function ProjectOverviewSkeleton() {
	return (
		<div className="flex w-full flex-col gap-6">
			<div className="grid gap-4 sm:grid-cols-3">
				<Skeleton className="h-20 w-full" />
				<Skeleton className="h-20 w-full" />
				<Skeleton className="h-20 w-full" />
			</div>
			<Skeleton className="h-64 w-full" />
			<Skeleton className="h-40 w-full" />
		</div>
	);
}
