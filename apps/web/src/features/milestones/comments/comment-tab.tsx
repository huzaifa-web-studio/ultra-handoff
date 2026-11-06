"use client";

/**
 * The Comments tab inside the milestone detail pane.
 *
 * Why this component owns the whole discussion layout: the composer is pinned
 * to the bottom edge and the threads scroll above it, so the pane and the
 * composer have to agree on one flex column. Splitting them would put the
 * composer inside the scrolling area, which is the one thing the design avoids.
 *
 * Behaviour worth knowing:
 *   - the list query only runs once the tab has been opened, so a milestone
 *     that is never discussed costs nothing
 *   - the first open scrolls to the newest comment, later opens keep the
 *     position the reader left
 *   - loading earlier comments preserves the current scroll position instead
 *     of jumping to the top of the new page
 *   - a post scrolls to the bottom and is announced to a screen reader
 *
 * Used by: milestone-detail-panel.tsx.
 */

import { Button } from "@org/ui/components/button";
import { ScrollArea } from "@org/ui/components/scroll-area";
import { ArrowDownIcon, RefreshCwIcon } from "lucide-react";
import {
	Fragment,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { MentionProvider } from "#/components/rich-text/mentions/mention-context";
import { useRealtimeEvent } from "#/features/realtime/provider";
import { useAtBottom } from "#/hooks/use-at-bottom";
import { useClockTick } from "#/hooks/use-clock-tick";
import type { Comment } from "./api";
import { CommentComposer } from "./comment-composer";
import { dayMarkers } from "./comment-day";
import { CommentDayDivider } from "./comment-day-divider";
import { CommentDeleteDialog } from "./comment-delete-dialog";
import { CommentSkeleton } from "./comment-skeleton";
import { CommentThread } from "./comment-thread";
import { useMilestoneComments } from "./hooks";
import { MilestoneEventItem } from "./milestone-event";
import { readCommentPayload } from "./realtime";

/**
 * Local state for open threads.
 *
 * Why localStorage: a reader who expands a thread expects it to stay open while
 * they move around the app or reload. The key is per milestone, so a different
 * milestone still starts collapsed. Storage is a convenience only: a disabled
 * or full store falls back to in-memory state for this mount.
 */
function expandedThreadsStorageKey(
	orgSlug: string,
	milestoneId: string,
): string {
	return `handoff:comment-expanded:${orgSlug}:${milestoneId}`;
}

/** Read the root ids the reader has opened, ignoring anything malformed. */
function readExpandedThreads(key: string): Set<string> {
	if (typeof window === "undefined") return new Set();

	try {
		const raw = window.localStorage.getItem(key);
		if (!raw) return new Set();

		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return new Set();

		return new Set(
			parsed.filter((value): value is string => typeof value === "string"),
		);
	} catch {
		return new Set();
	}
}

/** Persist the open threads. A failure must never break the thread UI. */
function writeExpandedThreads(key: string, value: Set<string>): void {
	if (typeof window === "undefined") return;

	try {
		window.localStorage.setItem(key, JSON.stringify([...value]));
	} catch {
		// A full or disabled store is not an error the reader needs to see.
	}
}

export function CommentTab({
	orgSlug,
	organizationId,
	projectId,
	milestoneId,
	viewerId,
	canComment,
	locked,
	active,
	onOpenCommentTab,
}: {
	orgSlug: string;
	organizationId: string;
	projectId: string;
	milestoneId: string;
	/** The signed in user, so their own comments can be marked. */
	viewerId: string;
	canComment: boolean;
	locked: boolean;
	/** True while this tab is selected, which is when the list is worth loading. */
	active: boolean;
	/** Open a root comment as its own tab. */
	onOpenCommentTab: (comment: Comment) => void;
}) {
	const query = useMilestoneComments(orgSlug, projectId, milestoneId, {
		enabled: active,
	});

	const scrollRef = useRef<HTMLDivElement>(null);
	const scrolledOnceRef = useRef(false);
	const pendingPrependRef = useRef<{ height: number; top: number } | null>(
		null,
	);

	const [pendingDelete, setPendingDelete] = useState<Comment | null>(null);
	const [announcement, setAnnouncement] = useState("");
	// Bumped after a root post so the effect below scrolls once the row is in.
	const [scrollToken, setScrollToken] = useState(0);

	// A remote comment while the reader is scrolled up must not steal the view.
	const [remoteCount, setRemoteCount] = useState(0);
	const { atBottomRef, measure } = useAtBottom(scrollRef);

	// Keeps the relative labels and the day headings honest while the tab is
	// visible. One timer for the whole list, none while the tab is hidden.
	useClockTick(active);

	/**
	 * React to a comment that arrived over the stream.
	 *
	 * Only roots are handled here. A reply lands inside its thread, and the
	 * thread already follows its own tail, so moving the whole page would be
	 * wrong. The author's own post is skipped because `handlePosted` already
	 * scrolled for it.
	 */
	useRealtimeEvent((event) => {
		if (event.type !== "comment.created") return;

		const payload = readCommentPayload(event);

		if (!payload || payload.milestoneId !== milestoneId) return;
		if (payload.comment.parentId) return;
		if (payload.comment.author?.id === viewerId) return;

		if (atBottomRef.current) {
			setScrollToken((current) => current + 1);
			return;
		}

		setRemoteCount((current) => current + 1);
		setAnnouncement(
			`New comment from ${payload.comment.author?.name ?? "someone"}.`,
		);
	});

	// The one reply target. The composer at the bottom renders the banner and
	// sends with this id as the parent, so a thread is one level and one draft.
	const [replyingTo, setReplyingTo] = useState<{
		id: string;
		name: string;
	} | null>(null);
	const [replyFocusToken, setReplyFocusToken] = useState(0);

	// Expanded threads are named by their root id. The set starts empty, so
	// every thread that arrives from the backend is collapsed until the reader
	// opens it. The choice is remembered per milestone.
	const expandedStorageKey = expandedThreadsStorageKey(orgSlug, milestoneId);
	const [expandedThreads, setExpandedThreads] = useState<Set<string>>(() =>
		readExpandedThreads(expandedStorageKey),
	);
	// Root elements, so a reply can bring its thread back into view.
	const threadRefs = useRef(new Map<string, HTMLLIElement>());

	useEffect(() => {
		writeExpandedThreads(expandedStorageKey, expandedThreads);
	}, [expandedStorageKey, expandedThreads]);

	// The API returns pages newest first; the pane reads oldest first.
	const threads = [...(query.data?.pages ?? [])]
		.reverse()
		.flatMap((page) => page.threads);

	// First open shows the newest comment, which is where a returning reader
	// expects to land.
	useEffect(() => {
		if (!active || scrolledOnceRef.current || !query.data) return;

		const element = scrollRef.current;

		if (!element) return;

		element.scrollTop = element.scrollHeight;
		scrolledOnceRef.current = true;
	}, [active, query.data]);

	// A new comment arrives at the bottom, so a smooth scroll follows the post.
	useEffect(() => {
		if (scrollToken === 0) return;

		const element = scrollRef.current;

		if (element) {
			element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
		}
	}, [scrollToken]);

	// Prepending older comments must not move what the reader is looking at.
	// Page count is the signal that new rows exist, and it is a cheaper
	// dependency than the whole page object.
	const pageCount = query.data?.pages.length ?? 0;

	useLayoutEffect(() => {
		if (query.isFetchingNextPage || pageCount === 0) return;

		const element = scrollRef.current;
		const pending = pendingPrependRef.current;

		if (!element || !pending) return;

		const delta = element.scrollHeight - pending.height;

		pendingPrependRef.current = null;

		if (delta > 0) {
			element.scrollTop = pending.top + delta;
		}
	}, [pageCount, query.isFetchingNextPage]);

	function loadEarlier() {
		const element = scrollRef.current;

		if (element) {
			pendingPrependRef.current = {
				height: element.scrollHeight,
				top: element.scrollTop,
			};
		}

		void query.fetchNextPage();
	}

	/** Clear the "new comments" pill as soon as the reader reaches the end. */
	function handleScroll() {
		if (measure()) setRemoteCount(0);
	}

	/** Jump to the latest comment from the pill. */
	function scrollToLatest() {
		setRemoteCount(0);
		setScrollToken((current) => current + 1);
	}

	/** Keep the root element of each thread available for a post-reply scroll. */
	const registerThreadRef = useCallback(
		(id: string, element: HTMLLIElement | null) => {
			if (element) {
				threadRefs.current.set(id, element);
			} else {
				threadRefs.current.delete(id);
			}
		},
		[],
	);

	const toggleThread = useCallback((id: string) => {
		setExpandedThreads((current) => {
			const next = new Set(current);

			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}

			return next;
		});
	}, []);

	/** Point the bottom composer at one root comment. */
	const handleReply = useCallback((comment: Comment) => {
		setReplyingTo({
			id: comment.id,
			name: comment.author?.name ?? "this comment",
		});

		// Replying to a collapsed thread should reveal the context discussed.
		setExpandedThreads((current) => {
			if (current.has(comment.id)) return current;

			const next = new Set(current);
			next.add(comment.id);
			return next;
		});

		setReplyFocusToken((current) => current + 1);
	}, []);

	function handlePosted() {
		const target = replyingTo;

		setAnnouncement(target ? "Reply posted." : "Comment posted.");

		if (target) {
			// A reply lands inside an existing thread, so show that thread rather
			// than jumping to the bottom of the pane.
			setExpandedThreads((current) => {
				if (current.has(target.id)) return current;

				const next = new Set(current);
				next.add(target.id);
				return next;
			});

			requestAnimationFrame(() => {
				threadRefs.current
					.get(target.id)
					?.scrollIntoView({ block: "start", behavior: "smooth" });
			});

			return;
		}

		setScrollToken((current) => current + 1);
	}

	function handleDeleted() {
		const deletedId = pendingDelete?.id ?? null;

		setPendingDelete(null);

		// Deleting the comment being replied to must clear the stale target.
		if (deletedId && replyingTo?.id === deletedId) {
			setReplyingTo(null);
		}

		setAnnouncement("Comment deleted.");
	}

	function renderContent() {
		if (query.isPending) {
			return (
				<div>
					<output className="sr-only">Loading comments</output>
					<div aria-hidden className="flex flex-col gap-5">
						<CommentSkeleton />
						<CommentSkeleton />
						<CommentSkeleton />
					</div>
				</div>
			);
		}

		if (query.isError) {
			return (
				<div className="flex flex-col gap-3 border border-danger bg-danger-bg p-3">
					<p role="alert" className="text-sm text-danger">
						{query.error instanceof Error
							? query.error.message
							: "Could not load the comments."}
					</p>
					<Button
						variant="surface"
						size="sm"
						className="self-start"
						onPress={() => void query.refetch()}
					>
						<RefreshCwIcon aria-hidden />
						Try again
					</Button>
				</div>
			);
		}

		if (threads.length === 0) {
			return (
				<div className="flex flex-col items-center gap-2 py-12 text-center">
					<p className="text-sm font-medium text-app-text">No comments yet</p>
					<p className="max-w-xs text-xs text-app-text-muted">
						Start the conversation with a question, a decision, or a note for
						the team.
					</p>
				</div>
			);
		}

		// One heading per day, computed over the merged pages so a day that
		// straddles a page boundary gets one divider, not two. The list is
		// already rebuilt on every render, so this is a single extra pass over
		// rows that are in memory, with no request and no query.
		const markers = dayMarkers(
			threads.map((thread) => thread.comment.createdAt),
			new Date(),
		);

		return (
			<ol className="flex flex-col gap-4">
				{threads.map((thread, index) => {
					const marker = markers[index];

					return (
						<Fragment key={thread.comment.id}>
							{marker ? <CommentDayDivider heading={marker} /> : null}

							{thread.comment.kind === "event" ? (
								<MilestoneEventItem event={thread.comment} />
							) : (
								<CommentThread
									orgSlug={orgSlug}
									organizationId={organizationId}
									projectId={projectId}
									milestoneId={milestoneId}
									viewerId={viewerId}
									thread={thread}
									canComment={canComment && !locked}
									collapsed={!expandedThreads.has(thread.comment.id)}
									isReplyTarget={replyingTo?.id === thread.comment.id}
									onToggle={() => toggleThread(thread.comment.id)}
									onReply={handleReply}
									onOpenTab={onOpenCommentTab}
									onRequestDelete={setPendingDelete}
									registerRef={registerThreadRef}
								/>
							)}
						</Fragment>
					);
				})}
			</ol>
		);
	}

	return (
		<MentionProvider value={{ orgSlug, projectId }}>
			<div className="flex min-h-0 flex-1 flex-col">
				{/* A live region, so the result is heard without moving the visual focus. */}
				<p aria-live="polite" className="sr-only">
					{announcement}
				</p>

				<div className="relative min-h-0 flex-1">
					<ScrollArea
						ref={scrollRef}
						className="h-full"
						onScroll={handleScroll}
					>
						<div className="flex flex-col gap-4 p-4">
							{query.hasNextPage && (
								<div className="flex justify-center">
									<Button
										variant="outline"
										size="xs"
										loading={query.isFetchingNextPage}
										onPress={loadEarlier}
									>
										Load earlier comments
									</Button>
								</div>
							)}

							{renderContent()}
						</div>
					</ScrollArea>

					{/*
					 * A remote comment arrived while the reader was further up.
					 * The pill is the polite alternative to yanking the view.
					 */}
					{remoteCount > 0 && (
						<div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
							<Button
								variant="surface"
								size="xs"
								className="pointer-events-auto"
								onPress={scrollToLatest}
							>
								<ArrowDownIcon aria-hidden />
								{remoteCount === 1
									? "1 new comment"
									: `${remoteCount} new comments`}
							</Button>
						</div>
					)}
				</div>

				{locked ? (
					<p className="border-t border-app-border p-4 text-xs text-app-text-muted">
						This project is archived, so the discussion is read only. Restore
						the project to reply.
					</p>
				) : canComment ? (
					<div className="border-t border-app-border p-3">
						<CommentComposer
							orgSlug={orgSlug}
							organizationId={organizationId}
							projectId={projectId}
							milestoneId={milestoneId}
							parentId={replyingTo?.id ?? null}
							replyingToName={replyingTo?.name}
							focusToken={replyFocusToken}
							onDone={replyingTo ? () => setReplyingTo(null) : undefined}
							onPosted={handlePosted}
						/>
					</div>
				) : (
					<p className="border-t border-app-border p-4 text-xs text-app-text-muted">
						You can read this discussion but not take part in it.
					</p>
				)}

				<CommentDeleteDialog
					orgSlug={orgSlug}
					projectId={projectId}
					milestoneId={milestoneId}
					comment={pendingDelete}
					isOpen={pendingDelete !== null}
					onOpenChange={(open) => {
						if (!open) setPendingDelete(null);
					}}
					onDeleted={handleDeleted}
				/>
			</div>
		</MentionProvider>
	);
}
