"use client";

/**
 * One open conversation.
 *
 * Why this component owns the read cursor: the cursor only moves while the tab
 * is visible and the thread is on screen. A background tab must never consume a
 * notification the person did not see, which is why the visibility listener
 * lives here and not in the realtime provider.
 *
 * Sending is optimistic. The composer keeps its draft until the request
 * resolves, and a failed row stays in place with a retry that reuses the same
 * nonce, so the server cannot store it twice.
 *
 * Used by: routes/_app/$orgSlug.messages.$conversationId.tsx.
 */

import { Avatar, AvatarFallback, AvatarImage } from "@org/ui/components/avatar";
import { Button } from "@org/ui/components/button";
import { Input } from "@org/ui/components/input";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeftIcon, RefreshCwIcon, SearchIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { authClient } from "#/features/auth/client";
import { formatDateTime } from "#/lib/date";
import { useConversationTypingSender } from "#/lib/realtime/typing-sender";
import {
	conversationChannel,
	useTypingUser,
} from "#/lib/realtime/typing-store";
import type { Message } from "./api";
import {
	useConversation,
	useJumpToMessage,
	useMarkConversationRead,
	useMessageSearch,
	useMessages,
	useSendMessage,
} from "./hooks";
import { MessageComposer } from "./message-composer";
import type { PendingMessage } from "./message-item";
import { MessageList } from "./message-list";

/** Initials for an avatar fallback. */
function initials(name: string): string {
	const parts = name.trim().split(/\s+/).slice(0, 2);

	return parts.map((part) => part.charAt(0).toUpperCase()).join("") || "?";
}

export function ConversationView({
	orgSlug,
	conversationId,
}: {
	orgSlug: string;
	conversationId: string;
}) {
	const navigate = useNavigate();
	const { data: session } = authClient.useSession();
	const { data: activeOrg } = authClient.useActiveOrganization();
	const viewerId = session?.user.id ?? "";
	const organizationId = activeOrg?.id ?? "";

	const detail = useConversation(orgSlug, conversationId);
	const thread = useMessages(orgSlug, conversationId);
	const send = useSendMessage(orgSlug, conversationId, viewerId);
	const markRead = useMarkConversationRead(orgSlug, conversationId);
	const jump = useJumpToMessage(orgSlug, conversationId);
	const notifyTyping = useConversationTypingSender(
		orgSlug,
		viewerId,
		conversationId,
	);

	const [pending, setPending] = useState<PendingMessage[]>([]);
	const [searchOpen, setSearchOpen] = useState(false);
	const [search, setSearch] = useState("");
	const [highlightId, setHighlightId] = useState<string | null>(null);

	const searchResults = useMessageSearch(orgSlug, conversationId, search);
	const typingUserId = useTypingUser(conversationChannel(conversationId));

	/*
	 * `pages[0]` is the newest page, so the pages are reversed before flattening
	 * to render oldest to newest.
	 */
	const messages = useMemo<Message[]>(() => {
		const pages = thread.data?.pages ?? [];

		return [...pages].reverse().flatMap((page) => page.messages);
	}, [thread.data?.pages]);

	const counterpartRead = thread.data?.pages[0]?.counterpartRead ?? null;
	const counterpart = detail.data?.conversation.counterpart ?? null;

	/** The last own message the other person has read. */
	const seenMessageId = useMemo(() => {
		if (!counterpartRead?.lastReadAt) return null;

		if (counterpartRead.lastReadMessageId) {
			const explicit = messages.find(
				(message) => message.id === counterpartRead.lastReadMessageId,
			);

			if (explicit?.author?.id === viewerId) return explicit.id;
		}

		const cursor = counterpartRead.lastReadAt;
		const own = [...messages]
			.reverse()
			.find(
				(message) =>
					message.author?.id === viewerId &&
					message.createdAt <= cursor &&
					message.deletedAt === null,
			);

		return own?.id ?? null;
	}, [counterpartRead, messages, viewerId]);

	/*
	 * Mark read only while visible.
	 *
	 * The refs keep the effect from re-running on every render, and a failed
	 * request clears the marker so a later render can retry.
	 */
	const newestId = messages[messages.length - 1]?.id ?? null;
	const newestRef = useRef<string | null>(null);
	const markedRef = useRef<string | null>(null);
	const markReadRef = useRef(markRead);

	useEffect(() => {
		markReadRef.current = markRead;
	}, [markRead]);

	useEffect(() => {
		newestRef.current = newestId;

		function attempt() {
			const id = newestRef.current;

			if (!id || markedRef.current === id) return;
			if (document.visibilityState !== "visible") return;

			markedRef.current = id;
			markReadRef.current.mutate(id, {
				onError: () => {
					markedRef.current = null;
				},
			});
		}

		attempt();
		document.addEventListener("visibilitychange", attempt);

		return () => document.removeEventListener("visibilitychange", attempt);
	}, [newestId]);

	const handleSend = useCallback(
		async (body: unknown[]) => {
			const nonce = crypto.randomUUID();

			setPending((current) => [...current, { nonce, body, failed: false }]);

			try {
				await send.mutateAsync({ body, clientNonce: nonce });
				setPending((current) => current.filter((item) => item.nonce !== nonce));
			} catch (error) {
				setPending((current) =>
					current.map((item) =>
						item.nonce === nonce ? { ...item, failed: true } : item,
					),
				);

				// The composer keeps the draft when the send rejects.
				throw error;
			}
		},
		[send],
	);

	const retryPending = useCallback(
		async (nonce: string) => {
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
				});
				setPending((current) =>
					current.filter((entry) => entry.nonce !== nonce),
				);
			} catch {
				setPending((current) =>
					current.map((entry) =>
						entry.nonce === nonce ? { ...entry, failed: true } : entry,
					),
				);
			}
		},
		[pending, send],
	);

	const name = counterpart?.name ?? "Conversation";
	const status = typingUserId
		? "typing..."
		: counterpart && !counterpart.isMember
			? "No longer in this workspace"
			: "Direct message";

	return (
		<div className="flex h-full min-h-0 flex-col">
			<header className="flex items-center gap-3 border-b border-app-border px-3 py-2">
				<Button
					variant="ghost"
					size="icon-sm"
					className="md:hidden"
					aria-label="Back to conversations"
					onPress={() =>
						void navigate({ to: "/$orgSlug/messages", params: { orgSlug } })
					}
				>
					<ArrowLeftIcon aria-hidden />
				</Button>

				<Avatar size="sm">
					{counterpart?.image && <AvatarImage src={counterpart.image} alt="" />}
					<AvatarFallback>{initials(name)}</AvatarFallback>
				</Avatar>

				<div className="min-w-0 flex-1">
					<p className="truncate text-sm font-medium text-app-text">{name}</p>
					<p className="truncate text-xs text-app-text-muted">{status}</p>
				</div>

				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Search this conversation"
					aria-pressed={searchOpen}
					onPress={() => setSearchOpen((current) => !current)}
				>
					<SearchIcon aria-hidden />
				</Button>
			</header>

			{searchOpen && (
				<div className="border-b border-app-border p-2">
					<div className="relative">
						<SearchIcon
							aria-hidden
							className="pointer-events-none absolute top-1/2 left-0 size-3.5 -translate-y-1/2 text-app-text-muted"
						/>
						<Input
							type="search"
							value={search}
							onChange={(event) => setSearch(event.target.value)}
							placeholder="Search this conversation"
							aria-label="Search this conversation"
							className="pl-6"
							autoFocus
						/>
						{search.length > 0 && (
							<Button
								variant="ghost"
								size="icon-xs"
								className="absolute top-1/2 right-0 -translate-y-1/2"
								aria-label="Clear search"
								onPress={() => setSearch("")}
							>
								<XIcon aria-hidden />
							</Button>
						)}
					</div>

					{search.trim().length >= 2 && (
						<div className="mt-2 max-h-56 overflow-y-auto border border-app-border">
							{searchResults.isPending ? (
								<p className="p-3 text-xs text-app-text-muted">Searching...</p>
							) : searchResults.isError ? (
								<p role="alert" className="p-3 text-xs text-danger">
									Could not search this conversation.
								</p>
							) : (searchResults.data?.results.length ?? 0) === 0 ? (
								<p className="p-3 text-xs text-app-text-muted">
									No messages match that search.
								</p>
							) : (
								searchResults.data?.results.map((result) => (
									<button
										key={result.id}
										type="button"
										className="block w-full border-b border-app-border px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-app-panel-subtle focus-visible:bg-app-selected focus-visible:outline-none"
										onClick={() => {
											void jump.mutateAsync(result.id);
											setHighlightId(result.id);
											setSearchOpen(false);
										}}
									>
										<span className="flex items-baseline gap-2">
											<span className="text-xs font-medium text-app-text">
												{result.authorName}
											</span>
											<span className="text-[0.65rem] text-app-text-muted">
												{formatDateTime(result.createdAt)}
											</span>
										</span>
										<span className="mt-0.5 block truncate text-xs text-app-text-muted">
											{result.snippet}
										</span>
									</button>
								))
							)}
						</div>
					)}
				</div>
			)}

			{thread.isPending ? (
				<div className="flex flex-1 items-center justify-center p-6">
					<p className="text-sm text-app-text-muted">Loading messages...</p>
				</div>
			) : thread.isError ? (
				<div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
					<p role="alert" className="text-sm text-danger">
						{thread.error instanceof Error
							? thread.error.message
							: "Could not load the messages."}
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
				<MessageList
					messages={messages}
					pending={pending}
					viewerId={viewerId}
					organizationId={organizationId}
					organizationSlug={orgSlug}
					seenMessageId={seenMessageId}
					hasOlder={Boolean(thread.hasNextPage)}
					loadingOlder={thread.isFetchingNextPage}
					onLoadOlder={() => void thread.fetchNextPage()}
					onRetryPending={(nonce) => void retryPending(nonce)}
					highlightId={highlightId}
				/>
			)}

			<div className="border-t border-app-border p-3">
				{counterpart && !counterpart.isMember ? (
					<p className="text-xs text-app-text-muted">
						This person is no longer part of the workspace, so this conversation
						is read only.
					</p>
				) : (
					<MessageComposer
						orgSlug={orgSlug}
						conversationId={conversationId}
						onSend={handleSend}
						onTyping={notifyTyping}
					/>
				)}
			</div>
		</div>
	);
}
