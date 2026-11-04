/**
 * Shared loading placeholder for a comment thread.
 *
 * Why one component: the main comments tab and a focused comment tab load the
 * same shape, and two skeletons would drift the moment one is adjusted.
 *
 * Used by: comment-tab.tsx and comment-thread-tab.tsx.
 */
export function CommentSkeleton() {
	return (
		<div className="flex gap-3">
			<div className="size-8 shrink-0 animate-pulse rounded-full bg-app-panel-subtle" />
			<div className="flex flex-1 flex-col gap-2">
				<div className="h-3 w-40 animate-pulse bg-app-panel-subtle" />
				<div className="h-3 w-full animate-pulse bg-app-panel-subtle" />
				<div className="h-3 w-2/3 animate-pulse bg-app-panel-subtle" />
			</div>
		</div>
	);
}
