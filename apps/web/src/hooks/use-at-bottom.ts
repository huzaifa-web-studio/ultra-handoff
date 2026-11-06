"use client";

/**
 * Track whether a scroll container is at its bottom edge.
 *
 * Why a hook: two comment surfaces need the same rule before they decide
 * whether a new row should move the reader. The rule is a measurement, not a
 * piece of state, so it lives in a ref and never triggers a render by itself.
 *
 * Used by: comments/comment-tab.tsx.
 */

import { type RefObject, useCallback, useRef } from "react";

/** Distance from the bottom that still counts as "reading the latest". */
const DEFAULT_THRESHOLD_PX = 80;

export function useAtBottom(
	ref: RefObject<HTMLElement | null>,
	threshold = DEFAULT_THRESHOLD_PX,
) {
	/** Assume the bottom on mount: the tab scrolls there once data arrives. */
	const atBottomRef = useRef(true);

	/**
	 * Measure now and remember the answer.
	 *
	 * Returns the measured value so a caller can clear a badge in the same
	 * scroll event, without waiting for a render.
	 */
	const measure = useCallback(() => {
		const element = ref.current;

		if (!element) return atBottomRef.current;

		atBottomRef.current =
			element.scrollHeight - element.scrollTop - element.clientHeight <=
			threshold;

		return atBottomRef.current;
	}, [ref, threshold]);

	return { atBottomRef, measure };
}
