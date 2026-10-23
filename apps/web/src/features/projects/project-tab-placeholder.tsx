/**
 * Placeholder for a project tab that is not built yet.
 *
 * Why one component: Milestones and Settings both need the same empty surface
 * now, and more tabs will follow. One component keeps them visually identical.
 *
 * Used by: the project milestones and settings tabs.
 */

export function ProjectTabPlaceholder({
	title,
	description,
}: {
	title: string;
	description: string;
}) {
	return (
		<section className="flex min-h-64 flex-col items-center justify-center gap-2 border border-app-border bg-app-panel p-12 text-center">
			<h2 className="text-lg font-bold text-app-text">{title}</h2>
			<p className="max-w-md text-sm text-app-text-muted">{description}</p>
			<span className="text-xs font-semibold tracking-widest text-app-text-muted uppercase">
				Coming soon
			</span>
		</section>
	);
}
