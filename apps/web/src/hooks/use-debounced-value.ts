import { useEffect, useState } from "react";

/**
 * Delay a fast changing value.
 *
 * Why: the invitations search is server side. Pushing every keystroke into the
 * URL would refetch on each character and flood the history of replace
 * navigations. A short debounce keeps typing responsive and the API quiet.
 *
 * Used by: features/invitations (search), features/members (search).
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
	const [debounced, setDebounced] = useState(value);

	useEffect(() => {
		const timer = window.setTimeout(() => setDebounced(value), delayMs);

		return () => window.clearTimeout(timer);
	}, [value, delayMs]);

	return debounced;
}
