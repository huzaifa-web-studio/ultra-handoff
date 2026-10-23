/**
 * Projects page loading shape.
 *
 * Why a component: the page returns this while the first request is in flight.
 * Matching the real header, summary, toolbar and table heights keeps the shell
 * from jumping when the data lands.
 *
 * Used by: projects-page.tsx.
 */

import { Skeleton } from "@org/ui/components/skeleton";

export function ProjectsPageSkeleton() {
	return (
		<div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
			<div className="flex flex-col gap-2">
				<Skeleton className="h-8 w-40" />
				<Skeleton className="h-4 w-96" />
			</div>
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
				<Skeleton className="h-20 w-full" />
				<Skeleton className="h-20 w-full" />
				<Skeleton className="h-20 w-full" />
			</div>
			<Skeleton className="h-12 w-full" />
			<Skeleton className="h-80 w-full" />
		</div>
	);
}
