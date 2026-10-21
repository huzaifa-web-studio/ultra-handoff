import {
	ArrowDownWideNarrowIcon,
	ArrowUpNarrowWideIcon,
	ChevronsUpDownIcon,
} from "lucide-react";

/**
 * Sort state icon for a table column header.
 *
 * Why: the header itself is the sort button, so the only visual cue was the
 * header text. This shows the current direction for the sorted column and a
 * quiet up/down pair for the other sortable columns.
 *
 * Used by: the members and invitations tables.
 */
export function SortIndicator({
	direction,
}: {
	direction: "asc" | "desc" | false;
}) {
	if (direction === "asc") {
		return (
			<ArrowUpNarrowWideIcon className="size-3.5 text-app-text" aria-hidden />
		);
	}

	if (direction === "desc") {
		return (
			<ArrowDownWideNarrowIcon className="size-3.5 text-app-text" aria-hidden />
		);
	}

	return (
		<ChevronsUpDownIcon className="size-3.5 text-app-text-muted" aria-hidden />
	);
}
