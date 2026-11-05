/**
 * Slow re-render clock for relative labels.
 *
 * Why: "4m ago", "Just now" and a "Today" divider are all computed at render
 * time, so a pane left open would keep claiming a comment is four minutes old an
 * hour later, and a divider would keep saying Today after midnight. One timer
 * for the whole list is cheaper than a timer per row.
 *
 * Why gated on `active`: a hidden tab has nothing to keep honest, so it holds no
 * timer at all. The returned value is never read. The re-render is the point.
 *
 * Used by: features/milestones/comments/comment-tab.tsx and
 * comment-thread-tab.tsx.
 */

import { useEffect, useState } from "react";

/** How long a relative label is allowed to stay stale. */
export const CLOCK_TICK_MS = 30_000;

export function useClockTick(active: boolean): void {
	const [, setTick] = useState(0);

	useEffect(() => {
		if (!active) return;

		const id = window.setInterval(() => {
			setTick((current) => current + 1);
		}, CLOCK_TICK_MS);

		return () => window.clearInterval(id);
	}, [active]);
}
