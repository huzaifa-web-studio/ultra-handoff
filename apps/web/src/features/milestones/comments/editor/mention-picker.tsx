"use client";

/**
 * The floating mention picker.
 *
 * Why a plain list instead of Plate's combobox input: the trigger stays inside
 * the editor as ordinary text. The writer keeps typing into the same editable,
 * and this panel only observes what follows the `@`. Nothing here can take
 * focus, so typing never stops mid-word.
 *
 * The panel is portalled and positioned at the caret. Mouse presses are
 * prevented from moving focus, so choosing an item does not make the editor
 * lose its selection.
 *
 * Used by: comment-editor.tsx.
 */

import { cn } from "cn";
import { FlagIcon, FolderIcon, UserIcon } from "lucide-react";
import { type RefObject, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import type { MentionType } from "./mention-key";

/** Shared id, so the editor can point at the listbox with aria-controls. */
export const MENTION_PICKER_ID = "comment-mention-picker";

/**
 * Fixed viewport coordinates for the panel.
 *
 * `top` and `bottom` are alternatives: a panel below the caret has a `top`, a
 * panel above it has a `bottom`. Anchoring the bottom edge is what keeps a short
 * list close to the caret instead of reserving a fixed tall height.
 */
export type MentionPanelPosition = {
	left: number;
	top?: number;
	bottom?: number;
	maxHeight: number;
};

/** One selectable mention, in stored form. */
export type MentionPickerItem = {
	/** Stable mention key, for example `project:abc`. */
	key: string;
	value: string;
	slug?: string;
	type: MentionType;
	/** Second line in the row, used for a milestone's project name. */
	secondary?: string;
	/** Flat position across every group, used for keyboard selection. */
	index: number;
};

/** One labelled block of results. */
export type MentionPickerGroup = {
	label: string;
	items: MentionPickerItem[];
};

/** The icon for one mention type. */
function OptionIcon({ type }: { type: MentionType }) {
	if (type === "user") {
		return (
			<UserIcon className="size-3.5 shrink-0 text-app-text-muted" aria-hidden />
		);
	}

	if (type === "project") {
		return (
			<FolderIcon
				className="size-3.5 shrink-0 text-app-text-muted"
				aria-hidden
			/>
		);
	}

	return (
		<FlagIcon className="size-3.5 shrink-0 text-app-text-muted" aria-hidden />
	);
}

export function MentionPicker({
	groups,
	activeIndex,
	loading,
	hasMore,
	position,
	pickerRef,
	onSelect,
	onHover,
}: {
	groups: MentionPickerGroup[];
	activeIndex: number;
	loading: boolean;
	/** True when at least one group hit the result limit. */
	hasMore: boolean;
	position: MentionPanelPosition;
	pickerRef: RefObject<HTMLDivElement | null>;
	onSelect: (item: MentionPickerItem) => void;
	onHover: (index: number) => void;
}) {
	const activeRef = useRef<HTMLButtonElement | null>(null);
	const total = groups.reduce((count, group) => count + group.items.length, 0);

	// Keep the highlighted row visible while the writer arrows through a long
	// list. `block: nearest` never scrolls the page itself. The effect has to
	// rerun when the highlight moves, even though it does not read the index.
	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll when the highlight moves
	useEffect(() => {
		activeRef.current?.scrollIntoView({ block: "nearest" });
	}, [activeIndex]);

	if (typeof document === "undefined") return null;

	return createPortal(
		<div
			ref={pickerRef}
			id={MENTION_PICKER_ID}
			role="listbox"
			aria-label="Mention suggestions"
			className="fixed z-50 w-80 overflow-y-auto border border-app-border bg-app-panel shadow-lg"
			style={{
				left: position.left,
				top: position.top,
				bottom: position.bottom,
				maxHeight: position.maxHeight,
			}}
		>
			{groups.map((group) => {
				if (group.items.length === 0) return null;

				return (
					<div
						key={group.label}
						className="border-b border-app-border py-1 last:border-b-0"
					>
						<div className="px-3 py-1 text-[0.65rem] font-semibold tracking-widest text-app-text-muted uppercase">
							{group.label}
						</div>

						{group.items.map((item) => {
							const active = item.index === activeIndex;

							return (
								<button
									key={item.key}
									ref={active ? activeRef : undefined}
									id={`${MENTION_PICKER_ID}-${item.index}`}
									type="button"
									role="option"
									aria-selected={active}
									// Keep the caret and the Slate selection in the editor.
									onMouseDown={(event) => event.preventDefault()}
									onMouseEnter={() => onHover(item.index)}
									onClick={() => onSelect(item)}
									className={cn(
										"flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-sm text-app-text transition-colors",
										active && "bg-app-selected",
										!active && "hover:bg-app-selected",
									)}
								>
									<OptionIcon type={item.type} />
									<span className="flex min-w-0 flex-col">
										<span className="truncate">{item.value}</span>
										{item.secondary && (
											<span className="truncate text-[0.65rem] text-app-text-muted">
												{item.secondary}
											</span>
										)}
									</span>
								</button>
							);
						})}
					</div>
				);
			})}

			{total === 0 && (
				<div className="px-3 py-2 text-sm text-app-text-muted">
					{loading ? "Searching..." : "No matches"}
				</div>
			)}

			{total > 0 && hasMore && (
				<div className="border-t border-app-border px-3 py-1.5 text-[0.65rem] text-app-text-muted">
					Keep typing to narrow the results
				</div>
			)}
		</div>,
		document.body,
	);
}
