"use client";

/**
 * In conversation search box and result overlay.
 *
 * Why extracted: the conversation view was over the file size target, and the
 * overlay owns its own outside click and keyboard handling. Keeping it here
 * means the view only decides what a selected hit means.
 *
 * Used by: features/messages/conversation-view.tsx.
 */

import { Button } from "@org/ui/components/button";
import { Input } from "@org/ui/components/input";
import { SearchIcon, XIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { formatDateTime } from "#/lib/date";

/** One hit the overlay renders. */
export type ConversationSearchResult = {
	id: string;
	rootId: string;
	authorName: string;
	createdAt: string;
	snippet: string;
};

export function ConversationSearch({
	value,
	onValueChange,
	results,
	isPending,
	isError,
	onSelect,
}: {
	value: string;
	onValueChange: (value: string) => void;
	results: ConversationSearchResult[];
	isPending: boolean;
	isError: boolean;
	/** The parent decides whether the hit is a root or a reply. */
	onSelect: (result: ConversationSearchResult) => void;
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const showResults = value.trim().length >= 2;

	// A click outside the box closes the overlay instead of leaving it open
	// over the conversation.
	useEffect(() => {
		if (!showResults) return;

		function onPointerDown(event: PointerEvent) {
			if (containerRef.current?.contains(event.target as Node)) return;

			onValueChange("");
		}

		document.addEventListener("pointerdown", onPointerDown);

		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [showResults, onValueChange]);

	return (
		<div ref={containerRef} className="relative w-36 shrink-0 sm:w-52 md:w-64">
			<SearchIcon
				aria-hidden
				className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-app-text-muted"
			/>
			<Input
				id="conversation-search"
				name="conversation-search"
				type="search"
				value={value}
				onChange={(event) => onValueChange(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Escape") onValueChange("");
				}}
				placeholder="Search"
				aria-label="Search this conversation"
				className="h-8 bg-transparent pr-7 pl-7"
			/>
			{value.length > 0 && (
				<Button
					variant="ghost"
					size="icon-xs"
					className="absolute top-1/2 right-0.5 -translate-y-1/2"
					aria-label="Clear search"
					onPress={() => onValueChange("")}
				>
					<XIcon aria-hidden />
				</Button>
			)}

			{showResults && (
				<div className="absolute top-full right-0 z-30 mt-1 max-h-80 w-80 max-w-[calc(100vw-2rem)] overflow-y-auto border border-app-border bg-app-panel shadow-lg">
					{isPending ? (
						<p className="p-3 text-xs text-app-text-muted">Searching...</p>
					) : isError ? (
						<p role="alert" className="p-3 text-xs text-danger">
							Could not search this conversation.
						</p>
					) : results.length === 0 ? (
						<p className="p-3 text-xs text-app-text-muted">
							No messages match that search.
						</p>
					) : (
						results.map((result) => {
							const isRoot = result.id === result.rootId;

							return (
								<button
									key={result.id}
									type="button"
									className="block w-full border-b border-app-border px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-app-panel-subtle focus-visible:bg-app-selected focus-visible:outline-none"
									onClick={() => onSelect(result)}
								>
									<span className="flex items-baseline gap-2">
										<span className="text-xs font-medium text-app-text">
											{result.authorName}
										</span>
										<span className="text-[0.65rem] text-app-text-muted">
											{formatDateTime(result.createdAt)}
										</span>
										{!isRoot && (
											<span className="text-[0.65rem] text-app-text-muted">
												in thread
											</span>
										)}
									</span>
									<span className="mt-0.5 block truncate text-xs text-app-text-muted">
										{result.snippet}
									</span>
								</button>
							);
						})
					)}
				</div>
			)}
		</div>
	);
}
