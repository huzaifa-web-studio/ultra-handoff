"use client";

/**
 * The thread panel beside a conversation.
 *
 * Why a panel: this is the shape the chat surface people already use has.
 * Replying keeps the main conversation on screen, so the context that made the
 * reply worth writing never disappears. A separate route still exists for a
 * deep link or a new browser tab, and the header offers it explicitly.
 *
 * The panel reads the same thread cache as the dedicated route and shares the
 * send mutation, so a reply sent here appears in both places and the root's
 * reply count stays truthful.
 *
 * The thread has its own read cursor. Opening the panel marks it read, which is
 * what clears the unread dot on the root chip.
 *
 * Used by: conversation-view.tsx.
 */

import { Button } from "@org/ui/components/button";
import { ScrollArea } from "@org/ui/components/scroll-area";
import { useQueryClient } from "@tanstack/react-query";
import {
	ArrowDownIcon,
	ExternalLinkIcon,
	RefreshCwIcon,
	XIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiRequestError } from "#/lib/api";
import { useConversationTypingSender } from "#/lib/realtime/typing-sender";
import type { ConversationMessage } from "./api";
import {
	useJumpToThreadMessage,
	useMarkThreadRead,
	useSendMessage,
	useThread,
} from "./hooks";
import { conversationThreadKey } from "./keys";
import { MessageComposer } from "./message-composer";
import { MessageItem, type PendingMessage } from "./message-item";

export function ThreadPanel({
	orgSlug,
	conversationId,
	organizationId,
	rootId,
	viewerId,
	jumpMessageId,
	focusToken,
	autoFocus,
	onClose,
	onOpenThread,
	readOnly = false,
	readOnlyNotice = "",
	onMissing,
}: {
	orgSlug: string;
	conversationId: string;
	organizationId: string;
	rootId: string;
	viewerId: string;
	/** A search hit inside this thread to scroll to. */
	jumpMessageId?: string | null;
	/** Bumped by Reply, so an already open panel focuses its composer. */
	focusToken: number;
	/** Focus the composer when the panel mounts. */
	autoFocus: boolean;
	onClose: () => void;
	/** Open the dedicated thread route in a new browser tab. */
	onOpenThread: (root: ConversationMessage | null) => void;
	/** True when the conversation is archived, so no reply can be written. */
	readOnly?: boolean;
	/** The sentence shown in place of the composer when archived. */
	readOnlyNotice?: string;
	/** Called when the root no longer exists, so the panel can close. */
	onMissing?: () => void;
}) {
	const queryClient = useQueryClient();
	const thread = useThread(orgSlug, conversationId, rootId);
	const send = useSendMessage(orgSlug, conversationId, viewerId);
	const markRead = useMarkThreadRead(orgSlug, conversationId, rootId);
	const jump = useJumpToThreadMessage(orgSlug, conversationId, rootId);
	const notifyTyping = useConversationTypingSender(
		orgSlug,
		viewerId,
		conversationId,
	);

	const [pending, setPending] = useState<PendingMessage[]>([]);
	const [highlightId, setHighlightId] = useState<string | null>(
		jumpMessageId ?? null,
	);
	const [jumpedAway, setJumpedAway] = useState(false);
	const scrollRef = useRef<HTMLDivElement>(null);
	const newestRef = useRef<string | null>(null);
	const markedRef = useRef<string | null>(null);
	const markRef = useRef(markRead);
	const jumpRef = useRef(jump);
	/** The last search hit this panel jumped to, so the same id is not repeated. */
	const lastJumpRef = useRef<string | null>(null);
	const lastCount = useRef(0);
	const atBottom = useRef(true);

	useEffect(() => {
		markRef.current = markRead;
		jumpRef.current = jump;
	}, [markRead, jump]);

	/*
	 * A 404 means the root no longer exists. That is an answer, not a transient
	 * failure, so the panel closes and lets the parent clear the deep link
	 * instead of leaving a dead thread with a retry button.
	 */
	useEffect(() => {
		if (
			!(thread.error instanceof ApiRequestError) ||
			thread.error.status !== 404
		) {
			return;
		}

		onMissing?.();
	}, [thread.error, onMissing]);

	/*
	 * A search hit can name a reply that is not on the newest page. Load the
	 * page around it once, then let the highlight effect scroll to it.
	 */
	useEffect(() => {
		if (!jumpMessageId || lastJumpRef.current === jumpMessageId) return;

		lastJumpRef.current = jumpMessageId;
		setHighlightId(jumpMessageId);

		void jumpRef.current
			.mutateAsync(jumpMessageId)
			.then(() => setJumpedAway(true))
			.catch(() => undefined);
	}, [jumpMessageId]);

	// A normal open (Reply, chip) clears any search highlight left behind.
	useEffect(() => {
		if (jumpMessageId) return;

		setHighlightId(null);
		setJumpedAway(false);
	}, [jumpMessageId]);

	const pages = thread.data?.pages ?? [];
	const root = pages[0]?.root ?? null;
	const replies = [...pages].reverse().flatMap((page) => page.replies);
	const counterpartRead = pages[0]?.counterpartRead ?? null;
	/** The total across every page, not only the replies currently loaded. */
	const totalReplies = Math.max(pages[0]?.replyCount ?? 0, replies.length);

	/** The last own reply the other person has read. */
	const seenReplyId = (() => {
		if (!counterpartRead?.lastReadAt) return null;

		if (counterpartRead.lastReadMessageId) {
			const explicit = replies.find(
				(reply) => reply.id === counterpartRead.lastReadMessageId,
			);

			if (explicit?.author?.id === viewerId) return explicit.id;
		}

		const cursor = counterpartRead.lastReadAt;
		const own = [...replies]
			.reverse()
			.find(
				(reply) =>
					reply.author?.id === viewerId &&
					reply.createdAt <= cursor &&
					reply.deletedAt === null,
			);

		return own?.id ?? null;
	})();

	const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
		const element = scrollRef.current;

		if (element) {
			element.scrollTo({ top: element.scrollHeight, behavior });
		}
	}, []);

	useEffect(() => {
		if (thread.isSuccess) scrollToBottom();
	}, [thread.isSuccess, scrollToBottom]);

	/*
	 * A jumped thread lands on the hit, not on the newest reply. The scroll is
	 * repeated on each data update so it survives the page arriving late.
	 */
	const dataUpdatedAt = thread.dataUpdatedAt;

	useEffect(() => {
		if (!highlightId || dataUpdatedAt === 0) return;

		document
			.getElementById(`thread-panel-message-${highlightId}`)
			?.scrollIntoView({ block: "center", behavior: "smooth" });
	}, [highlightId, dataUpdatedAt]);

	useEffect(() => {
		const count = replies.length + pending.length;

		if (count > lastCount.current && atBottom.current) {
			scrollToBottom("smooth");
		}

		lastCount.current = count;
	}, [replies.length, pending.length, scrollToBottom]);

	/*
	 * Opening the panel is reading the thread. The cursor covers the root and
	 * its replies, so the unread dot on the root chip clears.
	 */
	const newestId = (replies[replies.length - 1] ?? root)?.id ?? null;

	useEffect(() => {
		newestRef.current = newestId;

		function attempt() {
			const id = newestRef.current;

			if (!id || markedRef.current === id) return;
			if (document.visibilityState !== "visible") return;

			markedRef.current = id;
			markRef.current.mutate(id, {
				onError: () => {
					markedRef.current = null;
				},
			});
		}

		attempt();
		document.addEventListener("visibilitychange", attempt);

		return () => document.removeEventListener("visibilitychange", attempt);
	}, [newestId]);

	async function handleSend(body: unknown[]) {
		// Resending the same body after a failure reuses that row's nonce, so the
		// panel never shows an orphaned "Not sent" row beside a delivered one.
		const failed = pending.find(
			(item) =>
				item.failed && JSON.stringify(item.body) === JSON.stringify(body),
		);
		const nonce = failed?.nonce ?? crypto.randomUUID();

		if (failed) {
			setPending((current) =>
				current.map((item) =>
					item.nonce === nonce ? { ...item, failed: false } : item,
				),
			);
		} else {
			setPending((current) => [...current, { nonce, body, failed: false }]);
		}

		try {
			await send.mutateAsync({ body, clientNonce: nonce, parentId: rootId });
			setPending((current) => current.filter((item) => item.nonce !== nonce));
		} catch (error) {
			setPending((current) =>
				current.map((item) =>
					item.nonce === nonce ? { ...item, failed: true } : item,
				),
			);

			throw error;
		}
	}

	async function retryPending(nonce: string) {
		const item = pending.find((entry) => entry.nonce === nonce);

		if (!item) return;

		setPending((current) =>
			current.map((entry) =>
				entry.nonce === nonce ? { ...entry, failed: false } : entry,
			),
		);

		try {
			await send.mutateAsync({
				body: item.body,
				clientNonce: nonce,
				parentId: rootId,
			});
			setPending((current) => current.filter((entry) => entry.nonce !== nonce));
		} catch {
			setPending((current) =>
				current.map((entry) =>
					entry.nonce === nonce ? { ...entry, failed: true } : entry,
				),
			);
		}
	}

	return (
		<aside
			aria-label="Message thread"
			className="flex h-full w-full flex-col border-l border-app-border bg-app-panel"
		>
			<header className="flex h-14 shrink-0 items-center gap-2 border-b border-app-border px-4">
				<div className="min-w-0 flex-1">
					<p className="truncate text-sm font-semibold text-app-text">Thread</p>
					<p className="truncate text-xs text-app-text-muted">
						{root?.author?.name ?? "Replies"}
					</p>
				</div>

				{jumpedAway && (
					<Button
						variant="outline"
						size="sm"
						onPress={() => {
							setHighlightId(null);
							setJumpedAway(false);
							void queryClient.resetQueries({
								queryKey: conversationThreadKey(
									orgSlug,
									conversationId,
									rootId,
								),
							});
						}}
					>
						<ArrowDownIcon aria-hidden />
						Latest
					</Button>
				)}

				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Open thread in new tab"
					onPress={() => onOpenThread(root)}
				>
					<ExternalLinkIcon aria-hidden />
				</Button>

				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Close thread"
					onPress={onClose}
				>
					<XIcon aria-hidden />
				</Button>
			</header>

			{thread.isPending ? (
				<div className="flex flex-1 items-center justify-center p-6">
					<p className="text-sm text-app-text-muted">Loading thread...</p>
				</div>
			) : thread.isError ? (
				<div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
					<p role="alert" className="text-sm text-danger">
						Could not load the thread.
					</p>
					<Button
						variant="outline"
						size="sm"
						onPress={() => void thread.refetch()}
					>
						<RefreshCwIcon aria-hidden />
						Try again
					</Button>
				</div>
			) : (
				<>
					<ScrollArea
						ref={scrollRef}
						onScroll={(event) => {
							const element = event.currentTarget;

							atBottom.current =
								element.scrollHeight -
									element.scrollTop -
									element.clientHeight <
								48;
						}}
						className="min-h-0 flex-1"
					>
						<div className="flex min-h-full flex-col py-3">
							{thread.hasNextPage && (
								<div className="flex justify-center pb-2">
									<Button
										variant="ghost"
										size="xs"
										loading={thread.isFetchingNextPage}
										onPress={() => void thread.fetchNextPage()}
									>
										Load earlier replies
									</Button>
								</div>
							)}

							{root && (
								<div className="border-b border-app-border">
									<MessageItem
										message={root}
										viewerId={viewerId}
										organizationId={organizationId}
										organizationSlug={orgSlug}
										showSeen={false}
										elementId={`thread-panel-message-${root.id}`}
										highlighted={highlightId === root.id}
										hideReply
										readOnly={readOnly}
									/>
								</div>
							)}

							<div className="flex items-center gap-2 px-4 pt-3 pb-1">
								<span className="text-[0.65rem] font-semibold tracking-wide text-app-text-muted uppercase">
									{totalReplies === 0
										? "No replies yet"
										: `${totalReplies} ${
												totalReplies === 1 ? "reply" : "replies"
											}`}
								</span>
								<span className="h-px flex-1 bg-app-border" />
							</div>

							{replies.length === 0 ? (
								<p className="px-4 py-3 text-xs text-app-text-muted">
									Be the first to reply.
								</p>
							) : (
								replies.map((reply, index) => {
									const previous = replies[index - 1];
									const grouped = Boolean(
										previous &&
											previous.author?.id === reply.author?.id &&
											Math.abs(
												new Date(reply.createdAt).getTime() -
													new Date(previous.createdAt).getTime(),
											) <
												5 * 60 * 1000,
									);

									return (
										<MessageItem
											key={reply.id}
											message={reply}
											viewerId={viewerId}
											organizationId={organizationId}
											organizationSlug={orgSlug}
											showSeen={seenReplyId === reply.id}
											elementId={`thread-panel-message-${reply.id}`}
											grouped={grouped}
											highlighted={highlightId === reply.id}
											readOnly={readOnly}
										/>
									);
								})
							)}

							{pending.map((item) => (
								<MessageItem
									key={item.nonce}
									message={null}
									pending={item}
									viewerId={viewerId}
									organizationId={organizationId}
									organizationSlug={orgSlug}
									showSeen={false}
									onRetry={() => void retryPending(item.nonce)}
								/>
							))}
						</div>
					</ScrollArea>

					<div className="shrink-0 border-t border-app-border p-3">
						{root?.deletedAt ? (
							<p className="text-xs text-app-text-muted">
								This thread was deleted, so it is read only.
							</p>
						) : readOnly ? (
							<p className="text-xs text-app-text-muted">{readOnlyNotice}</p>
						) : (
							<MessageComposer
								orgSlug={orgSlug}
								conversationId={conversationId}
								onSend={handleSend}
								onTyping={notifyTyping}
								draftId={`${conversationId}:thread:${rootId}`}
								autoFocus={autoFocus}
								focusToken={focusToken}
								minHeightClass="min-h-10"
								placeholder="Reply..."
								ariaLabel="Write a reply"
							/>
						)}
					</div>
				</>
			)}
		</aside>
	);
}
