"use client";

/**
 * One row in a scope index.
 *
 * Why the whole row is a button: a scope list is a table of contents, so the
 * only action is opening the section. A nested button inside a row would fight
 * the row for the press and cost a second focus stop, so the trailing label is
 * plain text.
 *
 * The same row is used by the Overview summary and the Scope tab, which keeps
 * the two lists from growing different visual languages.
 *
 * Deliberately no text preview: the stored body is rich text, and flattening it
 * to a plain sentence here made the document read as raw prose in the list. The
 * row is a table of contents entry, so it shows what the section is and who
 * wrote it, and the document itself only renders in its own tab.
 *
 * Used by: scope-tab.tsx and milestone-detail-panel.tsx.
 */

import { cn } from "cn";
import { ChevronRightIcon } from "lucide-react";
import type { ScopeTabKind } from "./scope-kind";
import { ScopeKindChip } from "./scope-kind-chip";

export function ScopeIndexRow({
	kind,
	title,
	meta,
	badge,
	highlight = false,
	actionLabel = "Open",
	onOpen,
}: {
	kind: ScopeTabKind;
	title: string;
	/** Author and date, or a short status line for the baseline. */
	meta: string;
	/** "Current" for the round of the open phase. */
	badge?: string;
	/** True to tint the border, used for the current phase round. */
	highlight?: boolean;
	actionLabel?: string;
	onOpen: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onOpen}
			className={cn(
				"flex w-full cursor-pointer items-start gap-3 border bg-app-panel p-3 text-left outline-none transition-colors hover:bg-app-panel-subtle focus-visible:ring-2 focus-visible:ring-ring/30",
				highlight ? "border-app-focus" : "border-app-border",
			)}
		>
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<div className="flex flex-wrap items-center gap-2">
					<ScopeKindChip kind={kind} />
					<span className="min-w-0 truncate text-sm font-medium text-app-text">
						{title}
					</span>
					{badge && (
						<span className="bg-app-selected px-1.5 py-0.5 text-[0.6rem] font-semibold tracking-widest text-app-text uppercase">
							{badge}
						</span>
					)}
				</div>

				<span className="text-xs text-app-text-muted">{meta}</span>
			</div>

			<span className="flex shrink-0 items-center gap-1 self-center text-xs font-medium text-app-text-muted">
				{actionLabel}
				<ChevronRightIcon className="size-3.5" aria-hidden />
			</span>
		</button>
	);
}
