"use client";

/**
 * The save state of one scope document.
 *
 * Why its own component: the initial scope and every focused section tab
 * autosave the same way, and two copies of the live region is how they drift.
 *
 * Used by: baseline-scope-tab.tsx and scope-entry-tab.tsx.
 */

import { cn } from "cn";

/** Save indicator states. */
export type ScopeSaveState = "idle" | "saving" | "saved" | "error";

export function ScopeSaveIndicator({
	state,
	error,
	className,
}: {
	state: ScopeSaveState;
	error: string | null;
	className?: string;
}) {
	if (state === "idle") return null;

	return (
		<span
			aria-live="polite"
			className={cn(
				"text-xs",
				state === "error" ? "text-danger" : "text-app-text-muted",
				className,
			)}
		>
			{state === "saving" && "Saving..."}
			{state === "saved" && "Saved"}
			{state === "error" && (error ?? "Could not save.")}
		</span>
	);
}
