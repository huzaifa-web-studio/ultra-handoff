/**
 * Project workspace loading shape.
 *
 * Why a component: the layout renders this while the project request is in
 * flight. Matching the real header and tab heights keeps the page from jumping.
 *
 * Used by: project-workspace.tsx.
 */

import { Skeleton } from "@org/ui/components/skeleton";

export function ProjectWorkspaceSkeleton() {
	return (
		<div className="flex w-full flex-col gap-6">
			<Skeleton className="h-4 w-28" />
			<div className="flex items-start gap-3 border-b border-app-border pb-6">
				<Skeleton className="size-12" />
				<div className="flex flex-col gap-2">
					<Skeleton className="h-8 w-56" />
					<Skeleton className="h-4 w-32" />
					<Skeleton className="h-4 w-96" />
				</div>
			</div>
			<Skeleton className="h-10 w-full" />
			<Skeleton className="h-64 w-full" />
		</div>
	);
}
