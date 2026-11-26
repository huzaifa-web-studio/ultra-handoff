"use client";

/**
 * One focused message thread.
 *
 * Why a route of its own: a thread can be opened in a new browser tab, linked to
 * directly, and reached from a search hit. The conversation list stays visible
 * on a wide screen because the messages layout owns it.
 *
 * The thread has its own read cursor. Opening it marks the root and its newest
 * reply read; opening the conversation does not, which is what makes "new
 * replies" meaningful on the timeline.
 *
 * Used by: routes/_app/$orgSlug.messages.$conversationId.threads.$rootId.tsx.
 */

import { Avatar, AvatarFallback, AvatarImage } from "@org/ui/components/avatar";
import { Button } from "@org/ui/components/button";
import { ScrollArea } from "@org/ui/components/scroll-area";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import {
	ArrowDownIcon,
	ArrowLeftIcon,
	RefreshCwIcon,
	XIcon,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";

import { authClient } from "#/features/auth/client";
import { formatDayHeading } from "#/lib/date";
import { useConversationTypingSender } from "#/lib/realtime/typing-sender";
import {
	conversationChannel,
	useTypingUser,
} from "#/lib/realtime/typing-store";
import {
	useJumpToThreadMessage,
	useMarkThreadRead,
	useSendMessage,
	useThread,
} from "./hooks";
import { conversationThreadKey } from "./keys";
import { MessageComposer } from "./message-composer";
import { MessageItem, type PendingMessage } from "./message-item";
import {
	placeholderThreadTab,
	readThreadTabs,
	removeThreadTab,
	threadTabsStorageKey,
	toOpenThreadTab,
	updateThreadTab,
	writeThreadTabs,
} from "./thread-tabs";

/** Initials for an avatar fallback. */
function initials(name: string): string {
	const parts = name.trim().split(/\s+/).slice(0, 2);

	return parts.map((part) => part.charAt(0).toUpperCase()).join("") || "?";
}

export function ThreadView({
	orgSlug,
	conversationId,
	rootId,
	initialMessageId,
}: {
	orgSlug: string;
	conversationId: string;
	rootId: string;
	/** A search hit to scroll to when the thread opens. */
	initialMessageId: string | null;
}) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { data: session } = authClient.useSession();
	const { data: activeOrg } = authClient.useActiveOrganization();
	const viewerId = session?.user.id ?? "";
	const organizationId = activeOrg?.id ?? "";

	const tabsKey = threadTabsStorageKey(orgSlug, conversationId);
	const [openTabs, setOpenTabs] = useState(() => readThreadTabs(tabsKey));

	const thread = useThread(orgSlug, conversationId, rootId);
	const send = useSendMessage(orgSlug, conversationId, viewerId);
	const markRead = useMarkThreadRead(orgSlug, conversationId, rootId);
	const jump = useJumpToThreadMessage(orgSlug, conversationId, rootId);
	const notifyTyping = useConversationTypingSender(
		orgSlug,
		viewerId,
		conversationId,
	);
	const typingUserId = useTypingUser(conversationChannel(conversationId));

	const pages = thread.data?.pages ?? [];
	const root = pages[0]?.root ?? null;
	const replies = [...pages].reverse().flatMap((page) => page.replies);
	const counterpartRead = pages[0]?.counterpartRead ?? null;

	const [pending, setPending] = useState<PendingMessage[]>([]);
	const [highlightId, setHighlightId] = useState<string | null>(
		initialMessageId,
	);
	const [jumpedAway, setJumpedAway] = useState(false);
	const [atBottom, setAtBottom] = useState(true);
	const scrollRef = useRef<HTMLDivElement>(null);
	const lastCount = useRef(0);
	const jumpedRef = useRef(false);
	const jumpRef = useRef(jump);
	const markRef = useRef(markRead);
	const newestRef = useRef<string | null>(null);
	const markedRef = useRef<string | null>(null);

	useEffect(() => {
		jumpRef.current = jump;
		markRef.current = markRead;
	});

	// A deep link or a search hit may name a thread that is not in the stored
	// tab list yet. The root label replaces the placeholder once it loads.
	useEffect(() => {
		setOpenTabs((current) => {
			if (current.some((tab) => tab.rootId === rootId)) return current;

			const next = [...current, placeholderThreadTab(rootId)];

			writeThreadTabs(tabsKey, next);

			return next;
		});
	}, [rootId, tabsKey]);

	useEffect(() => {
		if (!root) return;

		const tab = toOpenThreadTab(root);
		const next = updateThreadTab(tabsKey, tab);

		setOpenTabs((current) =>
			current.some(
				(item) =>
					item.rootId === rootId &&
					(item.label !== tab.label || item.title !== tab.title),
			)
				? next
				: current,
		);
	}, [root, rootId, tabsKey]);

	// A search hit opens the page that contains the reply, once.
	useEffect(() => {
		if (!initialMessageId || jumpedRef.current) return;

		jumpedRef.current = true;
		setHighlightId(initialMessageId);

		void jumpRef.current
			.mutateAsync(initialMessageId)
			.then(() => setJumpedAway(true))
			.catch(() => undefined);
	}, [initialMessageId]);

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

	const newestId = (replies[replies.length - 1] ?? root)?.id ?? null;

	/*
	 * Mark the thread read while it is visible. The cursor covers the root and
	 * every reply, so it never collides with the conversation cursor.
	 */
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

	const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
		const element = scrollRef.current;

		if (element) {
			element.scrollTo({ top: element.scrollHeight, behavior });
		}
	}, []);

	useEffect(() => {
		if (thread.isSuccess) scrollToBottom();
	}, [thread.isSuccess, scrollToBottom]);

	useEffect(() => {
		const count = replies.length + pending.length;

		if (count > lastCount.current && atBottom) {
			scrollToBottom("smooth");
		}

		lastCount.current = count;
	}, [replies.length, pending.length, atBottom, scrollToBottom]);

	const dataUpdatedAt = thread.dataUpdatedAt;

	useEffect(() => {
		if (!highlightId || dataUpdatedAt === 0) return;

		document
			.getElementById(`message-${highlightId}`)
			?.scrollIntoView({ block: "center", behavior: "smooth" });
	}, [highlightId, dataUpdatedAt]);

	async function handleSend(body: unknown[]) {
		const nonce = crypto.randomUUID();

		setPending((current) => [...current, { nonce, body, failed: false }]);

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

	const goToThread = useCallback(
		(id: string) => {
			void navigate({
				to: "/$orgSlug/messages/$conversationId/threads/$rootId",
				params: { orgSlug, conversationId, rootId: id },
			});
		},
		[orgSlug, conversationId, navigate],
	);

	const closeTab = useCallback(
		(id: string) => {
			const next = removeThreadTab(tabsKey, id);

			setOpenTabs(next);

			if (id !== rootId) return;

			const fallback = next[next.length - 1];

			if (fallback) {
				goToThread(fallback.rootId);
				return;
			}

			void navigate({
				to: "/$orgSlug/messages/$conversationId",
				params: { orgSlug, conversationId },
			});
		},
		[tabsKey, rootId, goToThread, navigate, orgSlug, conversationId],
	);

	function jumpToLatest() {
		setHighlightId(null);
		setJumpedAway(false);

		void queryClient.resetQueries({
			queryKey: conversationThreadKey(orgSlug, conversationId, rootId),
		});
	}

	const authorName = root?.author?.name ?? "Thread";
	const status = typingUserId
		? "typing..."
		: root?.deletedAt
			? "This thread was deleted"
			: "Thread";

	return (
		<div className="flex h-full min-h-0 flex-col">
			<header className="flex items-center gap-3 border-b border-app-border px-3 py-2">
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Back to conversation"
					onPress={() =>
						void navigate({
							to: "/$orgSlug/messages/$conversationId",
							params: { orgSlug, conversationId },
						})
					}
				>
					<ArrowLeftIcon aria-hidden />
				</Button>

				<Avatar size="sm">
					{root?.author?.image && (
						<AvatarImage src={root.author.image} alt="" />
					)}
					<AvatarFallback>{initials(authorName)}</AvatarFallback>
				</Avatar>

				<div className="min-w-0 flex-1">
					<p className="truncate text-sm font-medium text-app-text">
						{authorName}
					</p>
					<p className="truncate text-xs text-app-text-muted">{status}</p>
				</div>

				{jumpedAway && (
					<Button variant="outline" size="sm" onPress={jumpToLatest}>
						<ArrowDownIcon aria-hidden />
						Latest
					</Button>
				)}
			</header>

			{openTabs.length > 0 && (
				<div className="flex items-center gap-1 overflow-x-auto border-b border-app-border px-2 py-1">
					{openTabs.map((tab) => (
						<div
							key={tab.rootId}
							className={cn(
								"flex shrink-0 items-center border",
								tab.rootId === rootId
									? "border-app-focus bg-app-selected"
									: "border-app-border bg-app-panel",
							)}
						>
							<button
								type="button"
								title={tab.title}
								onClick={() => goToThread(tab.rootId)}
								className="max-w-48 truncate px-2 py-1 text-xs text-app-text focus-visible:outline-none"
							>
								{tab.label}
							</button>
							<Button
								variant="ghost"
								size="icon-xs"
								aria-label={`Close ${tab.label}`}
								onPress={() => closeTab(tab.rootId)}
							>
								<XIcon aria-hidden />
							</Button>
						</div>
					))}
				</div>
			)}

			{thread.isPending ? (
				<div className="flex flex-1 items-center justify-center p-6">
					<p className="text-sm text-app-text-muted">Loading thread...</p>
				</div>
			) : thread.isError ? (
				<div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
					<p role="alert" className="text-sm text-danger">
						{thread.error instanceof Error
							? thread.error.message
							: "Could not load the thread."}
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
			) : root ? (
				<>
					<ScrollArea
						ref={scrollRef}
						onScroll={() => {
							const element = scrollRef.current;

							if (!element) return;

							setAtBottom(
								element.scrollHeight -
									element.scrollTop -
									element.clientHeight <
									56,
							);
						}}
						className="min-h-0 flex-1"
					>
						<div className="flex min-h-full w-full flex-col py-3">
							{thread.hasNextPage && (
								<div className="flex justify-center pb-2">
									<Button
										variant="ghost"
										size="sm"
										loading={thread.isFetchingNextPage}
										onPress={() => void thread.fetchNextPage()}
									>
										Load earlier replies
									</Button>
								</div>
							)}

							<div className="border-b border-app-border">
								<MessageItem
									message={root}
									viewerId={viewerId}
									organizationId={organizationId}
									organizationSlug={orgSlug}
									showSeen={false}
									highlighted={highlightId === root.id}
									hideReply
								/>
							</div>

							{replies.length === 0 && pending.length === 0 ? (
								<p className="py-4 text-center text-xs text-app-text-muted">
									No replies yet.
								</p>
							) : null}

							{replies.map((reply, index) => {
								const previous = replies[index - 1];
								// The divider compares against the root at the top, so a
								// same-day reply does not repeat the day the root already
								// introduced.
								const dayAnchor = previous ?? root;
								const heading = formatDayHeading(reply.createdAt);
								const previousHeading = dayAnchor
									? formatDayHeading(dayAnchor.createdAt)
									: null;
								const showDivider =
									!previousHeading || previousHeading.key !== heading.key;

								const grouped =
									!showDivider &&
									previous?.author?.id === reply.author?.id &&
									Math.abs(
										new Date(reply.createdAt).getTime() -
											new Date(previous.createdAt).getTime(),
									) <
										5 * 60 * 1000;

								return (
									<Fragment key={reply.id}>
										{showDivider && (
											<div className="my-3 flex items-center gap-3 px-4">
												<span className="h-px flex-1 bg-app-border" />
												<span className="text-[0.65rem] font-semibold tracking-wide text-app-text-muted uppercase">
													{heading.label ?? heading.absolute}
												</span>
												<span className="h-px flex-1 bg-app-border" />
											</div>
										)}
										<MessageItem
											message={reply}
											viewerId={viewerId}
											organizationId={organizationId}
											organizationSlug={orgSlug}
											showSeen={seenReplyId === reply.id}
											grouped={grouped}
											highlighted={highlightId === reply.id}
										/>
									</Fragment>
								);
							})}

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

					<div className="border-t border-app-border px-4 pt-2 pb-4">
						<div className="w-full">
							{root.deletedAt ? (
								<p className="text-xs text-app-text-muted">
									This thread was deleted, so it is read only.
								</p>
							) : (
								<MessageComposer
									orgSlug={orgSlug}
									conversationId={conversationId}
									onSend={handleSend}
									onTyping={notifyTyping}
									draftId={`${conversationId}:thread:${rootId}`}
									ariaLabel="Write a reply"
									placeholder="Reply..."
								/>
							)}
						</div>
					</div>
				</>
			) : (
				<div className="flex flex-1 items-center justify-center p-6">
					<p className="text-sm text-app-text-muted">
						This thread is no longer available.
					</p>
				</div>
			)}
		</div>
	);
}
