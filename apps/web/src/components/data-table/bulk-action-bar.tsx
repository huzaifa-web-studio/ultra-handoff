import { Button } from "@org/ui/components/button";
import { XIcon } from "lucide-react";
import type * as React from "react";

/**
 * Sticky summary of a table selection.
 *
 * Why one component: the members, projects and invitations tables all need the
 * same "N selected" bar. `aria-live` announces the count when a selection
 * changes, and the region label tells a screen reader what the buttons act on.
 *
 * Why an optional `max`: every bulk route accepts a limited batch. Showing the
 * limit next to the count tells the user why a batch could be refused before
 * they press the button, instead of after.
 *
 * Used by: features/members, features/projects and features/invitations.
 */
export function BulkActionBar({
	count,
	max,
	onClear,
	children,
}: {
	count: number;
	/** Largest batch the bulk routes accept. Omit when the bar is uncapped. */
	max?: number;
	onClear: () => void;
	children?: React.ReactNode;
}) {
	// The API caps a batch, so the bar says so once the selection reaches the
	// cap. Selection handlers clamp as well; this is the visible half.
	const atLimit = max !== undefined && count >= max;

	return (
		<section
			aria-live="polite"
			aria-label="Bulk actions"
			className="flex flex-wrap items-center gap-2 border border-app-border bg-app-panel-subtle px-3 py-2"
		>
			<p className="text-sm font-medium text-app-text">
				{max === undefined
					? `${count} selected`
					: `${count} of ${max} selected`}
			</p>
			{atLimit && (
				<p className="text-xs text-warning">
					You can act on up to {max} rows at a time.
				</p>
			)}
			<div className="ml-auto flex flex-wrap items-center gap-2">
				{children}
				<Button
					variant="ghost"
					size="sm"
					aria-label="Clear selection"
					onPress={onClear}
				>
					<XIcon aria-hidden />
					<span className="hidden sm:inline">Clear</span>
				</Button>
			</div>
		</section>
	);
}
