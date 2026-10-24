"use client";

/**
 * Resizable split panes in the aria-sera style.
 *
 * Why: the milestone view is a master detail layout. A fixed split would waste
 * space on one side for every user, so the divider is draggable and the chosen
 * split is remembered.
 *
 * Built on `react-resizable-panels` v4, which renders the flex direction and
 * panel sizes itself, so these wrappers only carry the design tokens, the
 * focus ring and the drag handle.
 *
 * Used by: features/milestones/milestone-page.tsx.
 */

import { cn } from "cn";
import type * as React from "react";
import * as ResizablePrimitive from "react-resizable-panels";

/** The container. Panels must be direct children, separated by Separators. */
function ResizablePanelGroup({
	className,
	...props
}: React.ComponentProps<typeof ResizablePrimitive.Group>) {
	return (
		<ResizablePrimitive.Group
			data-slot="resizable-panel-group"
			className={cn("h-full w-full", className)}
			{...props}
		/>
	);
}

/** One pane. Sizes are percentages unless a unit is given. */
function ResizablePanel({
	...props
}: React.ComponentProps<typeof ResizablePrimitive.Panel>) {
	return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />;
}

/**
 * The drag divider.
 *
 * The visible line is one pixel and the hit area is widened with an absolutely
 * positioned pseudo element, because a 1px target is impossible to grab. The
 * wider hit area is what makes the divider usable on a trackpad.
 */
function ResizableHandle({
	withHandle = false,
	className,
	...props
}: React.ComponentProps<typeof ResizablePrimitive.Separator> & {
	withHandle?: boolean;
}) {
	return (
		<ResizablePrimitive.Separator
			data-slot="resizable-handle"
			className={cn(
				"relative flex w-px shrink-0 items-center justify-center bg-app-border",
				"after:absolute after:inset-y-0 after:left-1/2 after:w-2 after:-translate-x-1/2",
				"focus-visible:ring-1 focus-visible:ring-app-focus focus-visible:outline-hidden",
				"aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:inset-x-0 aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-2 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:-translate-y-1/2",
				"[&[aria-orientation=horizontal]>div]:rotate-90",
				className,
			)}
			{...props}
		>
			{withHandle && (
				// A visible grip so the divider reads as draggable, not as a border.
				<div className="z-10 flex h-6 w-1 shrink-0 bg-app-border-strong" />
			)}
		</ResizablePrimitive.Separator>
	);
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup };

/**
 * Persist and restore a group layout.
 *
 * Re-exported so app code can use the library's own hook without adding a
 * second copy of `react-resizable-panels` to the web app.
 */
export { useDefaultLayout } from "react-resizable-panels";
