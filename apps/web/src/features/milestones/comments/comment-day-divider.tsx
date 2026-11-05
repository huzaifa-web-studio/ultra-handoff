"use client";

/**
 * One day divider inside a comment list.
 *
 * Why this exists: a discussion that spans several days reads as one long run
 * of cards otherwise, and the reader has to open every timestamp to know where
 * one day ends. A centred rule with the day on it is the pattern every chat
 * application uses, and it scans faster than a date on each card.
 *
 * Why a plain `<li>` with text and no ARIA role: both callers render this inside
 * an `<ol>`, so it has to be a list child, and the day is real content rather
 * than a decorative line. A `separator` role would make it an interactive
 * widget that needs a focus target and a value, which it is not. The visible
 * label plus the screen reader only prefix reads naturally in the list flow.
 *
 * Used by: comment-tab.tsx and comment-thread.tsx.
 */

import type { DayHeading } from "#/lib/date";

export function CommentDayDivider({ heading }: { heading: DayHeading }) {
	// "Today" alone is a relative label, so the absolute date travels with it.
	// Rule 24 requires the day month year form to always be available.
	return (
		<li className="flex items-center gap-3 py-1">
			<span aria-hidden className="h-px flex-1 bg-app-border" />

			<span className="flex shrink-0 items-baseline gap-1.5 whitespace-nowrap text-xs">
				<span className="sr-only">Comments from </span>

				{heading.label ? (
					<>
						<span className="font-medium text-app-text">{heading.label}</span>
						<span className="text-app-text-muted">{heading.absolute}</span>
					</>
				) : (
					<span className="font-medium text-app-text-muted">
						{heading.absolute}
					</span>
				)}
			</span>

			<span aria-hidden className="h-px flex-1 bg-app-border" />
		</li>
	);
}
