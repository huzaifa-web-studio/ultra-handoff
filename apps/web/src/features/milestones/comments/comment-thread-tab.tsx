"use client";

/**
 * A focused comment tab.
 *
 * Why this exists: a long discussion is easier to follow when one root comment
 * can be pulled into its own tab, with only its replies and its own composer.
 * The reader can keep several of these open and move between them without
 * losing the main Comments list or the milestone overview.
 *
 * The tab is mounted only after its first activation. Once mounted it stays
 * mounted, so a draft and the reply scroll position survive switching tabs.
 *
 * Used by: milestone-detail-panel.tsx.
 */

import { Button } from "@org/ui/components/button";
import { ScrollArea } from "@org/ui/components/scroll-area";
import { RefreshCwIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { MentionProvider } from "#/components/rich-text/mentions/mention-context";
import { useClockTick } from "#/hooks/use-clock-tick";
import { formatDayHeading } from "#/lib/date";
import type { Comment } from "./api";
import { CommentComposer } from "./comment-composer";
import { CommentDayDivider } from "./comment-day-divider";
import { CommentDeleteDialog } from "./comment-delete-dialog";
import { CommentSkeleton } from "./comment-skeleton";
import { CommentThread } from "./comment-thread";
import { useCommentThread } from "./hooks";

export function CommentThreadTab({
	orgSlug,
	organizationId,
	projectId,
	milestoneId,
	viewerId,
	commentId,
	canComment,
	locked,
	active,
	onClose,
}: {
	orgSlug: string;
	organizationId: string;
	projectId: string;
	milestoneId: string;
	viewerId: string;
	/** The root comment this tab is focused on. */
	commentId: string;
	canComment: boolean;
	locked: boolean;
	/** True while this tab is the selected one. */
	active: boolean;
	onClose: () => void;
}) {
	// The panel is force mounted, but the query and the composer should only
	// start after the reader has actually visited this tab once.
	const [hasBeenActive, setHasBeenActive] = useState(active);

	useEffect(() => {
		if (active) setHasBeenActive(true);
	}, [active]);

	const query = useCommentThread(orgSlug, projectId, milestoneId, commentId, {
		enabled: hasBeenActive,
	});

	const [pendingDelete, setPendingDelete] = useState<Comment | null>(null);
	const [replyFocusToken, setReplyFocusToken] = useState(0);
	const scrollRef = useRef<HTMLDivElement>(null);

	// A focused thread can span days, so its day headings and relative labels
	// need the same slow refresh as the main list.
	useClockTick(active);

	const registerThreadRef = useCallback(
		(_id: string, _element: HTMLLIElement | null) => undefined,
		[],
	);

	/** Keep a newly posted reply in view in the focused tab. */
	function handlePosted() {
		requestAnimationFrame(() => {
			const element = scrollRef.current;

			if (element) {
				element.scrollTo({
					top: element.scrollHeight,
					behavior: "smooth",
				});
			}
		});
	}

	if (!hasBeenActive) return null;

	if (query.isPending) {
		return (
			<div className="flex flex-1 flex-col p-4">
				<output className="sr-only">Loading discussion</output>
				<div aria-hidden className="flex flex-col gap-5">
					<CommentSkeleton />
					<CommentSkeleton />
				</div>
			</div>
		);
	}

	if (query.isError || !query.data) {
		return (
			<div className="flex flex-1 flex-col justify-center gap-3 p-6">
				<p role="alert" className="text-sm text-danger">
					{query.error instanceof Error
						? query.error.message
						: "Could not load the discussion."}
				</p>
				<div className="flex flex-wrap gap-2">
					<Button
						variant="outline"
						size="sm"
						onPress={() => void query.refetch()}
					>
						<RefreshCwIcon aria-hidden />
						Try again
					</Button>
					<Button variant="ghost" size="sm" onPress={onClose}>
						<XIcon aria-hidden />
						Close tab
					</Button>
				</div>
			</div>
		);
	}

	const { thread } = query.data;
	const authorName = thread.comment.author?.name ?? "Former member";
	const deleted = thread.comment.deletedAt !== null;
	const canWrite = canComment && !locked;

	/*
	 * The root's own day heading.
	 *
	 * Why here and not inside CommentThread: the main list already renders a
	 * heading above each card, so the thread must not add a second one there.
	 * This tab has no outer list, so without this the reader would see a "Today"
	 * divider halfway down a thread that started yesterday and never see the
	 * starting day at all.
	 */
	const rootHeading = formatDayHeading(thread.comment.createdAt);

	return (
		<MentionProvider value={{ orgSlug, projectId }}>
			<div className="flex min-h-0 flex-1 flex-col">
				<ScrollArea ref={scrollRef} className="min-h-0 flex-1">
					<div className="p-4">
						<ol className="flex flex-col gap-2">
							<CommentDayDivider heading={rootHeading} />

							<CommentThread
								orgSlug={orgSlug}
								organizationId={organizationId}
								projectId={projectId}
								milestoneId={milestoneId}
								viewerId={viewerId}
								thread={thread}
								canComment={canWrite}
								collapsed={false}
								collapsible={false}
								frameless
								replyScroll={false}
								isReplyTarget={false}
								onToggle={() => undefined}
								onReply={() => setReplyFocusToken((current) => current + 1)}
								onRequestDelete={setPendingDelete}
								registerRef={registerThreadRef}
							/>
						</ol>
					</div>
				</ScrollArea>

				{deleted ? (
					<p className="border-t border-app-border p-4 text-xs text-app-text-muted">
						This discussion was deleted. The replies remain for context.
					</p>
				) : canWrite ? (
					<div className="border-t border-app-border p-3">
						<CommentComposer
							orgSlug={orgSlug}
							organizationId={organizationId}
							projectId={projectId}
							milestoneId={milestoneId}
							parentId={thread.comment.id}
							replyingToName={authorName}
							focusToken={replyFocusToken}
							onPosted={handlePosted}
						/>
					</div>
				) : (
					<p className="border-t border-app-border p-4 text-xs text-app-text-muted">
						{locked
							? "This project is archived, so the discussion is read only."
							: "You can read this discussion but not take part in it."}
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
					onDeleted={() => setPendingDelete(null)}
				/>
			</div>
		</MentionProvider>
	);
}
