"use client";

/**
 * The message timeline.
 *
 * Why it owns scrolling: a chat has three scroll rules that must agree. Opening
 * lands at the newest message, a new message follows the tail only when the
 * reader is already there, and loading an older page keeps the viewport on the
 * same message instead of jumping.
 *
 * Messages are grouped by author and day, the way a chat transcript reads. The
 * first row of a group carries the avatar, name and time, and the rows under it
 * drop the repeated header. Day dividers use the shared date helpers, so a chat
 * reads the same as a comment thread.
 *
 * Used by: conversation-view.tsx.
 */

import { Button } from "@org/ui/components/button";
import { ScrollArea } from "@org/ui/components/scroll-area";
import { cn } from "cn";
import { ArrowDownIcon, Loader2Icon } from "lucide-react";
import {
	Fragment,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

import { formatDayHeading } from "#/lib/date";
import type { Message } from "./api";
import { MessageItem, type PendingMessage } from "./message-item";

/** The distance from the bottom that still counts as "at the bottom". */
const BOTTOM_SLACK_PX = 56;

/** A run of messages from one author is grouped for this long. */
const GROUP_WINDOW_MS = 5 * 60 * 1000;

export function MessageList({
	messages,
	pending,
	viewerId,
	organizationId,
	organizationSlug,
	seenMessageId,
	hasOlder,
	loadingOlder,
	onLoadOlder,
	onRetryPending,
	onReply,
	onOpenThreadInNewTab,
	activeThreadId,
	highlightId,
}: {
	messages: Message[];
	pending: PendingMessage[];
	viewerId: string;
	organizationId: string;
	organizationSlug: string;
	/** The last own message the other person has read. */
	seenMessageId: string | null;
	hasOlder: boolean;
	loadingOlder: boolean;
	onLoadOlder: () => void;
	onRetryPending: (nonce: string) => void;
	/** Open the thread panel for a root and focus its composer. */
	onReply: (message: Message) => void;
	/** Open the dedicated thread view in a new browser tab. */
	onOpenThreadInNewTab: (message: Message) => void;
	/** The root whose thread panel is open. */
	activeThreadId: string | null;
	/** A search hit to scroll to and highlight. */
	highlightId: string | null;
}) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const [atBottom, setAtBottom] = useState(true);
	const [unseen, setUnseen] = useState(false);
	const prependHeight = useRef<number | null>(null);
	const lastCount = useRef(0);

	const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
		const element = scrollRef.current;

		if (element) {
			element.scrollTo({ top: element.scrollHeight, behavior });
		}
	}, []);

	// First paint lands at the newest message.
	useEffect(() => {
		scrollToBottom();
	}, [scrollToBottom]);

	// A new message follows the tail only when the reader is already there.
	useEffect(() => {
		const count = messages.length + pending.length;

		if (count > lastCount.current) {
			if (atBottom) {
				scrollToBottom("smooth");
			} else {
				setUnseen(true);
			}
		}

		lastCount.current = count;
	}, [messages.length, pending.length, atBottom, scrollToBottom]);

	// Loading an older page keeps the viewport on the message it was showing.
	useLayoutEffect(() => {
		const element = scrollRef.current;

		if (element && prependHeight.current !== null && messages.length > 0) {
			element.scrollTop += element.scrollHeight - prependHeight.current;
			prependHeight.current = null;
		}
	}, [messages]);

	// A search hit is scrolled into view and marked for the highlight ring.
	useEffect(() => {
		if (!highlightId) return;

		const element = document.getElementById(`message-${highlightId}`);

		element?.scrollIntoView({ block: "center", behavior: "smooth" });
	}, [highlightId]);

	function handleScroll() {
		const element = scrollRef.current;

		if (!element) return;

		const bottom =
			element.scrollHeight - element.scrollTop - element.clientHeight <
			BOTTOM_SLACK_PX;

		setAtBottom(bottom);

		if (bottom) setUnseen(false);
	}

	function loadOlder() {
		const element = scrollRef.current;

		if (element) prependHeight.current = element.scrollHeight;

		onLoadOlder();
	}

	const lastMessage = messages[messages.length - 1];

	return (
		<div className="relative min-h-0 flex-1">
			<ScrollArea ref={scrollRef} onScroll={handleScroll} className="h-full">
				{/*
				 * `justify-end` anchors a short history to the bottom of the pane,
				 * right above the composer, which is where a chat starts. Once the
				 * history is taller than the pane it scrolls normally.
				 */}
				<div className="flex min-h-full w-full flex-col justify-end py-3">
					{hasOlder && (
						<div className="flex justify-center pb-2">
							<Button
								variant="ghost"
								size="sm"
								loading={loadingOlder}
								onPress={loadOlder}
							>
								{loadingOlder && (
									<Loader2Icon aria-hidden className="animate-spin" />
								)}
								Load earlier messages
							</Button>
						</div>
					)}

					{messages.length === 0 && pending.length === 0 ? (
						<div className="flex flex-col items-center justify-center gap-1 py-16 text-center">
							<p className="text-sm font-medium text-app-text">
								No messages yet
							</p>
							<p className="text-xs text-app-text-muted">
								Say hello to start the conversation.
							</p>
						</div>
					) : null}

					{messages.map((message, index) => {
						const previous = messages[index - 1];
						const heading = formatDayHeading(message.createdAt);
						const previousHeading = previous
							? formatDayHeading(previous.createdAt)
							: null;
						const showDivider =
							!previousHeading || previousHeading.key !== heading.key;

						/*
						 * A run from one author collapses only inside one day and only
						 * while the rows are close together. A long silence restarts the
						 * header, because the time is the useful piece of information
						 * at that point.
						 */
						const grouped =
							!showDivider &&
							previous?.author?.id === message.author?.id &&
							Math.abs(
								new Date(message.createdAt).getTime() -
									new Date(previous.createdAt).getTime(),
							) < GROUP_WINDOW_MS;

						return (
							<Fragment key={message.id}>
								{showDivider && (
									<div className="my-3 flex items-center gap-3 px-4">
										<span className="h-px flex-1 bg-app-border" />
										<span className="text-[0.65rem] font-semibold tracking-wide text-app-text-muted uppercase">
											{heading.label ?? heading.absolute}
										</span>
										<span className="h-px flex-1 bg-app-border" />
									</div>
								)}

								<div className={cn(!grouped && index > 0 && "mt-2")}>
									<MessageItem
										message={message}
										viewerId={viewerId}
										organizationId={organizationId}
										organizationSlug={organizationSlug}
										showSeen={seenMessageId === message.id}
										replyCount={message.replyCount}
										unreadReplyCount={message.unreadReplyCount}
										grouped={grouped}
										highlighted={highlightId === message.id}
										repliesOpen={activeThreadId === message.id}
										onReply={() => onReply(message)}
										onOpenThread={() => onOpenThreadInNewTab(message)}
									/>
								</div>
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
							organizationSlug={organizationSlug}
							showSeen={false}
							onRetry={() => onRetryPending(item.nonce)}
						/>
					))}
				</div>
			</ScrollArea>

			{/* New messages are announced, not read out as a live region per row. */}
			<output aria-live="polite" className="sr-only">
				{lastMessage
					? `New message from ${lastMessage.author?.name ?? "someone"}`
					: ""}
			</output>

			{unseen && (
				<Button
					size="sm"
					className="absolute right-4 bottom-4 shadow-md"
					onPress={() => {
						scrollToBottom("smooth");
						setUnseen(false);
					}}
				>
					<ArrowDownIcon aria-hidden />
					New messages
				</Button>
			)}
		</div>
	);
}
