/**
 * Project settings loading shape.
 *
 * Why a component: both settings sections need a quiet placeholder while their
 * query resolves. Matching the real cards keeps the layout from jumping.
 *
 * Used by: project-general-page.tsx and project-members-page.tsx.
 */

import { Skeleton } from "@org/ui/components/skeleton";

export function ProjectSettingsSkeleton() {
	return (
		<div className="flex w-full flex-col gap-6">
			<div className="flex flex-col gap-2">
				<Skeleton className="h-8 w-48" />
				<Skeleton className="h-4 w-80" />
			</div>
			<Skeleton className="h-72 w-full" />
			<Skeleton className="h-40 w-full" />
		</div>
	);
}
