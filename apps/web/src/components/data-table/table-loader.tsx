import { Loader2 } from "lucide-react";

/**
 * Loading overlay for a table scroll area.
 *
 * Why an overlay: during a filter change or a refresh, the previous rows stay on
 * screen (the invitations query keeps previous data). A small spinner over the
 * table says the data is being replaced without collapsing the layout or
 * flashing a skeleton.
 *
 * Used by: the members and invitations table cards.
 */
export function TableLoader({ label = "Loading..." }: { label?: string }) {
	return (
		<div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-app-panel/70">
			<output
				aria-live="polite"
				className="flex items-center gap-2 border border-app-border bg-app-panel px-3 py-2 shadow-sm"
			>
				<Loader2
					className="size-4 animate-spin text-app-text-muted"
					aria-hidden
				/>
				<span className="text-sm text-app-text-muted">{label}</span>
			</output>
		</div>
	);
}
