"use client";

/**
 * The message thread.
 *
 * Why it owns scrolling: a chat has three scroll rules that must agree. Opening
 * lands at the newest message, a new message follows the tail only when the
 * reader is already there, and loading an older page keeps the viewport on the
 * same message instead of jumping.
 *
 * Day dividers use the shared date helpers, so a chat reads the same as a
 * comment thread.
 *
 * Used by: conversation-view.tsx.
 */

import { Button } from "@org/ui/components/button";
import { ScrollArea } from "@org/ui/components/scroll-area";
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
				<div className="flex flex-col gap-4 p-4">
					{hasOlder && (
						<div className="flex justify-center">
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

						return (
							<Fragment key={message.id}>
								{showDivider && (
									<div className="flex items-center gap-3">
										<span className="h-px flex-1 bg-app-border" />
										<span className="text-[0.65rem] font-medium tracking-wide text-app-text-muted uppercase">
											{heading.label ?? heading.absolute}
										</span>
										<span className="h-px flex-1 bg-app-border" />
									</div>
								)}

								<div
									className={
										highlightId === message.id
											? "bg-app-selected/40 outline outline-app-focus"
											: undefined
									}
								>
									<MessageItem
										message={message}
										viewerId={viewerId}
										organizationId={organizationId}
										organizationSlug={organizationSlug}
										showSeen={seenMessageId === message.id}
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
