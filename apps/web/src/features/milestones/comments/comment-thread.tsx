"use client";

/**
 * One root comment and its replies, as a bounded card.
 *
 * Why a card per thread: a flat timeline makes it hard to see where one
 * discussion ends and the next begins. The card border is the explicit end of
 * the thread, and the replies sit inside it behind a count toggle.
 *
 * Why the reply box is not here: replying focuses the one composer pinned to
 * the bottom of the tab, and that composer shows who is being replied to. One
 * composer means one place to write, one draft, and no stack of open reply
 * boxes down a long thread.
 *
 * Why the collapsed state is owned by the tab: posting a reply has to expand
 * the thread it belongs to, and only the tab knows when a post succeeded.
 *
 * Used by: comment-tab.tsx.
 */

import { Button } from "@org/ui/components/button";
import { cn } from "cn";
import { ChevronDownIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import type { Comment, CommentThread as CommentThreadType } from "./api";
import { CommentItem } from "./comment-item";

/**
 * Replies beyond this count get a bounded, scrollable list.
 *
 * Why a threshold instead of always scrolling: a thread with one or two replies
 * should grow naturally. The nested scroll only appears when the list would
 * otherwise push the rest of the discussion far down the page.
 */
const REPLY_SCROLL_AFTER = 4;

export function CommentThread({
	orgSlug,
	organizationId,
	projectId,
	milestoneId,
	viewerId,
	thread,
	canComment,
	collapsed,
	collapsible = true,
	frameless = false,
	replyScroll = true,
	isReplyTarget,
	onToggle,
	onReply,
	onOpenTab,
	onRequestDelete,
	registerRef,
}: {
	orgSlug: string;
	organizationId: string;
	projectId: string;
	milestoneId: string;
	/** The signed in user, so their own comments can be marked. */
	viewerId: string;
	thread: CommentThreadType;
	canComment: boolean;
	collapsed: boolean;
	/** False in a focused tab, where the whole thread is the point. */
	collapsible?: boolean;
	/**
	 * True in a focused tab: no card outline and no tinted root. The tab is
	 * already the container, so a second frame only adds noise.
	 */
	frameless?: boolean;
	/** False in a focused tab, where the page scroll shows every reply. */
	replyScroll?: boolean;
	/** True while the bottom composer is replying to this thread. */
	isReplyTarget: boolean;
	onToggle: () => void;
	/** Set the main composer's reply target to this root comment. */
	onReply: (comment: Comment) => void;
	/** Open this root comment as its own tab. Omitted inside a focused tab. */
	onOpenTab?: (comment: Comment) => void;
	onRequestDelete: (comment: Comment) => void;
	/** Lets the tab scroll this thread into view after a reply is posted. */
	registerRef: (id: string, element: HTMLLIElement | null) => void;
}) {
	const replyCount = thread.replies.length;
	const repliesOverflow = replyCount > REPLY_SCROLL_AFTER;

	const repliesRef = useRef<HTMLOListElement>(null);
	const previousReplyCount = useRef(replyCount);

	// A reply added while the thread is open should land in view, even when the
	// list has its own scrollbar. A thread that was already long on first mount
	// is left at the top instead of jumping to the end.
	useEffect(() => {
		if (replyCount <= previousReplyCount.current) {
			previousReplyCount.current = replyCount;
			return;
		}

		const element = repliesRef.current;

		if (element) {
			element.scrollTo({
				top: element.scrollHeight,
				behavior: "smooth",
			});
		}

		previousReplyCount.current = replyCount;
	}, [replyCount]);

	return (
		<li
			ref={(element) => registerRef(thread.comment.id, element)}
			className={cn(
				"transition-colors",
				frameless
					? "bg-transparent"
					: cn(
							"border bg-app-panel",
							isReplyTarget
								? "border-app-focus ring-1 ring-app-focus/30"
								: "border-app-border",
						),
			)}
		>
			<div
				className={cn(
					frameless ? "p-0" : "p-3",
					!frameless && isReplyTarget && "bg-app-selected/30",
				)}
			>
				<CommentItem
					orgSlug={orgSlug}
					organizationId={organizationId}
					projectId={projectId}
					milestoneId={milestoneId}
					viewerId={viewerId}
					comment={thread.comment}
					canComment={canComment}
					onReply={() => onReply(thread.comment)}
					onOpenTab={onOpenTab ? () => onOpenTab(thread.comment) : undefined}
					onRequestDelete={onRequestDelete}
				/>
			</div>

			{replyCount > 0 && (
				<>
					{collapsible && (
						<div className="flex items-center border-t border-app-border px-3 py-1.5">
							<Button
								variant="ghost"
								size="xs"
								aria-expanded={!collapsed}
								onPress={onToggle}
								className="text-app-text-muted"
							>
								<ChevronDownIcon
									className={cn(
										"transition-transform",
										collapsed && "-rotate-90",
									)}
									aria-hidden
								/>
								{replyCount} {replyCount === 1 ? "reply" : "replies"}
							</Button>
						</div>
					)}

					{(!collapsible || !collapsed) && (
						<ol
							ref={repliesRef}
							className={cn(
								"ml-6 flex flex-col gap-3 border-l border-app-border py-3 pl-4 pr-3",
								!collapsible && !frameless && "border-t",
								replyScroll &&
									repliesOverflow &&
									"max-h-96 overflow-y-auto overscroll-contain",
							)}
						>
							{thread.replies.map((reply) => (
								<li key={reply.id}>
									<CommentItem
										orgSlug={orgSlug}
										organizationId={organizationId}
										projectId={projectId}
										milestoneId={milestoneId}
										viewerId={viewerId}
										comment={reply}
										isReply
										canComment={canComment}
										onRequestDelete={onRequestDelete}
									/>
								</li>
							))}
						</ol>
					)}
				</>
			)}
		</li>
	);
}
