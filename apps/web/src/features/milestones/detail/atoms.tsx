"use client";

/**
 * Small presentational pieces for the milestone detail pane.
 *
 * Why this file: the metadata cell, the save indicator and the reader tab
 * trigger are used in more than one place in the pane. Keeping them out of the
 * stateful content component makes that component about state, not markup.
 *
 * Used by: `detail/header.tsx`, `detail/overview-tab.tsx`,
 * `detail/tab-strip.tsx` and `milestone-detail-panel.tsx`.
 */

import { Button } from "@org/ui/components/button";
import { TabsTrigger } from "@org/ui/components/tabs";
import { cn } from "cn";
import { XIcon } from "lucide-react";
import type { ReactNode } from "react";

/** Save indicator states. */
export type SaveState = "idle" | "saving" | "saved" | "error";

/** A small labelled cell in the metadata grid. */
export function MetaField({
	label,
	className,
	children,
}: {
	label: string;
	className?: string;
	children: ReactNode;
}) {
	return (
		<div className={cn("flex flex-col gap-1", className)}>
			<span className="text-[0.65rem] font-semibold tracking-widest text-app-text-muted uppercase">
				{label}
			</span>
			{children}
		</div>
	);
}

/**
 * The save state as text, so it can sit in a footer or beside a hint without
 * repeating the same live region in two places.
 */
export function SaveStateText({
	saveState,
	saveError,
	className,
}: {
	saveState: SaveState;
	saveError: string | null;
	className?: string;
}) {
	return (
		<span
			aria-live="polite"
			className={cn(
				saveState === "error" ? "text-danger" : "text-app-text-muted",
				className,
			)}
		>
			{saveState === "saving" && "Saving..."}
			{saveState === "saved" && "Saved"}
			{saveState === "error" && (saveError ?? "Could not save.")}
		</span>
	);
}

/**
 * The save indicator for the fields that autosave.
 *
 * Why its own component: the metadata form and the scope document both need it,
 * and repeating the live region in two tabs is how the two copies drift.
 */
export function SaveStatus({
	saveState,
	saveError,
	onRetry,
}: {
	saveState: SaveState;
	saveError: string | null;
	onRetry: () => void;
}) {
	return (
		<div className="flex min-h-9 items-center justify-between gap-2 border-t border-app-border px-4 py-1.5 text-xs">
			<SaveStateText saveState={saveState} saveError={saveError} />

			{saveState === "error" && (
				<Button size="xs" variant="outline" onPress={onRetry}>
					Retry
				</Button>
			)}
		</div>
	);
}

/**
 * One reader opened tab in the strip.
 *
 * Why its own component: scope tabs and comment tabs share one strip, and two
 * copies of the close button is how the keyboard behaviour drifts. The first
 * reader tab carries the vertical rule that separates the fixed sections from
 * the reader's own tabs.
 */
export function ReaderTabTrigger({
	tabKey,
	label,
	ariaLabel,
	first,
	onClose,
	registerRef,
}: {
	tabKey: string;
	label: string;
	ariaLabel?: string;
	first: boolean;
	onClose: () => void;
	registerRef: (element: HTMLDivElement | null) => void;
}) {
	return (
		<TabsTrigger
			id={tabKey}
			aria-label={ariaLabel}
			ref={registerRef}
			className={cn(
				"max-w-48 flex-none cursor-pointer gap-1.5 pr-1.5 normal-case tracking-normal",
				first &&
					"ml-2 pl-3 before:absolute before:inset-y-1.5 before:left-0 before:w-px before:bg-app-border before:content-['']",
			)}
		>
			<span className="min-w-0 truncate">{label}</span>

			{/*
			 * A quick close on the tab itself. It stops the press from selecting
			 * the tab and stays a real focus stop so keyboard users can close a
			 * tab without leaving the strip.
			 */}
			<button
				type="button"
				aria-label={`Close ${label}`}
				className="flex size-6 shrink-0 cursor-pointer items-center justify-center text-app-text-muted transition-colors hover:bg-app-panel-subtle hover:text-app-text"
				onPointerDown={(event) => event.stopPropagation()}
				onClick={(event) => {
					event.stopPropagation();
					onClose();
				}}
			>
				<XIcon className="size-3.5" aria-hidden />
			</button>
		</TabsTrigger>
	);
}
