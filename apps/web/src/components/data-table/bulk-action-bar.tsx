import { Button } from "@org/ui/components/button";
import { XIcon } from "lucide-react";
import type * as React from "react";

/**
 * Sticky summary of a table selection.
 *
 * Why one component: the members table and the invitations table both need the
 * same "N selected" bar. `aria-live` announces the count when a selection
 * changes, and the region label tells a screen reader what the buttons act on.
 *
 * Used by: features/members and features/invitations.
 */
export function BulkActionBar({
	count,
	onClear,
	children,
}: {
	count: number;
	onClear: () => void;
	children?: React.ReactNode;
}) {
	return (
		<section
			aria-live="polite"
			aria-label="Bulk actions"
			className="flex flex-wrap items-center gap-2 border border-app-border bg-app-panel-subtle px-3 py-2"
		>
			<p className="text-sm font-medium text-app-text">{count} selected</p>
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
