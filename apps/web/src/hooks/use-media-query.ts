/**
 * Media query hook.
 *
 * Why: the milestone view is a split pane on wide screens and a list plus sheet
 * on narrow ones. Both layouts are rendered from different component trees, so
 * the switch has to be decided in JavaScript, not only in CSS.
 *
 * The initial value is read synchronously because the app renders on the client
 * only (SPA mode), so the first paint already has the right layout and there is
 * no flash of the wrong one.
 *
 * Used by: features/milestones/milestone-page.tsx.
 */

import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean {
	const [matches, setMatches] = useState(() =>
		typeof window === "undefined" ? false : window.matchMedia(query).matches,
	);

	useEffect(() => {
		const media = window.matchMedia(query);

		function handleChange() {
			setMatches(media.matches);
		}

		// Read once more after mount, so a query that changed between the
		// initial render and the effect is not missed.
		handleChange();
		media.addEventListener("change", handleChange);

		return () => media.removeEventListener("change", handleChange);
	}, [query]);

	return matches;
}
