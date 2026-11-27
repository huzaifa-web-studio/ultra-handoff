"use client";

/**
 * One open conversation.
 *
 * Why the read cursor is moved from here: the cursor only moves while the tab
 * is visible and the thread is on screen. A background tab must never consume a
 * notification the person did not see. The visibility rule lives in
 * `use-conversation-read.ts`, and the send/retry rule in
 * `use-conversation-send.ts`.
 *
 * Layout: the conversation is one full width column, and a thread opens in a
 * panel beside it. That keeps the reply in context instead of navigating away
 * from the message it answers.
 *
 * Sending is optimistic. The composer keeps its draft until the request
 * resolves, and a failed row stays in place with a retry that reuses the same
 * nonce, so the server cannot store it twice.
 *
 * Used by: routes/_app/$orgSlug.messages.$conversationId.index.tsx.
 */

import { Button } from "@org/ui/components/button";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
	useDefaultLayout,
} from "@org/ui/components/resizable";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowDownIcon, RefreshCwIcon, Settings2Icon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { authClient } from "#/features/auth/client";
import { useMediaQuery } from "#/hooks/use-media-query";
import { ApiRequestError } from "#/lib/api";
import { useConversationTypingSender } from "#/lib/realtime/typing-sender";
import {
	conversationChannel,
	useTypingUsers,
} from "#/lib/realtime/typing-store";
import type { Message } from "./api";
import { ChannelSettingsDialog } from "./channel-settings";
import { ConversationIdentity } from "./conversation-identity";
import {
	ConversationSearch,
	type ConversationSearchResult,
} from "./conversation-search";
import {
	useConversation,
	useJumpToMessage,
	useMarkConversationRead,
	useMessageSearch,
	useMessages,
	useSendMessage,
} from "./hooks";
import { conversationMessagesKey } from "./keys";
import { MessageComposer } from "./message-composer";
import { MessageList } from "./message-list";
import { ThreadPanel } from "./thread-panel";
import {
	addThreadTab,
	type OpenThreadTab,
	placeholderThreadTab,
	threadTabsStorageKey,
	toOpenThreadTab,
} from "./thread-tabs";
import { useConversationReadOnVisible } from "./use-conversation-read";
import { useConversationSend } from "./use-conversation-send";

export function ConversationView({
	orgSlug,
	conversationId,
	projectName,
	threadHref,
	initialThreadId,
	onMissing,
}: {
	orgSlug: string;
	conversationId: string;
	/**
	 * The project name for a project room. The conversation row deliberately
	 * leaves its title null, because a project can be renamed and the project
	 * row is the source of truth for the name.
	 */
	projectName?: string;
	/** Build the URL for opening a thread in a real tab. */
	threadHref?: (rootId: string) => string;
	/** A root id from a notification deep link, opened on first render. */
	initialThreadId?: string | null;
	/** Where to go when the conversation no longer exists. */
	onMissing?: () => void;
}) {
	const queryClient = useQueryClient();
	const { data: session } = authClient.useSession();
	const { data: activeOrg } = authClient.useActiveOrganization();
	const viewerId = session?.user.id ?? "";
	const organizationId = activeOrg?.id ?? "";

	/*
	 * The thread split is remembered per browser, so a width the reader chose
	 * survives a reload and every conversation. Below the tablet breakpoint the
	 * chat is too narrow for two panes, so the thread covers the conversation
	 * instead and the handle is not rendered.
	 */
	const isDesktop = useMediaQuery("(min-width: 768px)");
	const layout = useDefaultLayout({
		id: "handoff-messages-thread-split-v1",
		panelIds: ["conversation", "thread"],
	});

	const detail = useConversation(orgSlug, conversationId);
	const thread = useMessages(orgSlug, conversationId);
	const send = useSendMessage(orgSlug, conversationId, viewerId);
	const markRead = useMarkConversationRead(orgSlug, conversationId);
	const jump = useJumpToMessage(orgSlug, conversationId);
	const navigate = useNavigate();
	const notifyTyping = useConversationTypingSender(
		orgSlug,
		viewerId,
		conversationId,
	);

	const { pending, handleSend, retryPending } = useConversationSend(send);
	const [search, setSearch] = useState("");
	const [highlightId, setHighlightId] = useState<string | null>(null);
	const [jumped, setJumped] = useState(false);
	const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
	const [settingsOpen, setSettingsOpen] = useState(false);
	/** A reply search hit to jump to inside the panel. */
	const [threadJumpId, setThreadJumpId] = useState<string | null>(null);
	/** Whether opening the panel should focus its composer. */
	const [threadFocusOnOpen, setThreadFocusOnOpen] = useState(true);
	const [replyFocusToken, setReplyFocusToken] = useState(0);

	const searchResults = useMessageSearch(orgSlug, conversationId, search);
	const typingUsers = useTypingUsers(conversationChannel(conversationId));

	const threadTabsKey = threadTabsStorageKey(orgSlug, conversationId);

	// Switching conversation closes any thread panel from the previous one. A
	// deep link opens the thread it names on the same pass.
	useEffect(() => {
		if (!conversationId) return;

		setActiveThreadId(initialThreadId ?? null);
		setThreadJumpId(null);
		setReplyFocusToken(0);
	}, [conversationId, initialThreadId]);

	// A removed member gets a 404 on the detail read. Leaving the pane on an
	// error would strand the reader in a conversation they can no longer open.
	useEffect(() => {
		if (
			!(detail.error instanceof ApiRequestError) ||
			detail.error.status !== 404
		) {
			return;
		}

		if (onMissing) {
			onMissing();
			return;
		}

		void navigate({ to: "/$orgSlug/messages", params: { orgSlug } });
	}, [detail.error, navigate, onMissing, orgSlug]);

	/** Open the thread panel under one root and focus its composer. */
	const handleReply = useCallback((message: Message) => {
		setActiveThreadId(message.id);
		setThreadJumpId(null);
		setThreadFocusOnOpen(true);
		setReplyFocusToken((current) => current + 1);
	}, []);

	/** A search hit either jumps the timeline to a root or opens its thread. */
	const handleSearchSelect = useCallback(
		(result: ConversationSearchResult) => {
			const isRoot = result.id === result.rootId;

			if (isRoot) {
				void jump
					.mutateAsync(result.id)
					.then(() => {
						setHighlightId(result.id);
						setJumped(true);
					})
					.catch(() => undefined);
			} else {
				setActiveThreadId(result.rootId);
				setThreadJumpId(result.id);
				setThreadFocusOnOpen(false);
				setReplyFocusToken(0);
			}

			setSearch("");
		},
		[jump],
	);

	/**
	 * Open a thread in a real new browser tab.
	 *
	 * A panel can be showing a root that is not in the loaded timeline page, so
	 * the tab entry is built from the thread's own root when the caller has it,
	 * and from a placeholder otherwise.
	 */
	const openThreadTab = useCallback(
		(rootId: string, tab?: OpenThreadTab) => {
			addThreadTab(threadTabsKey, tab ?? placeholderThreadTab(rootId));

			const href =
				threadHref?.(rootId) ??
				`/${orgSlug}/messages/${conversationId}/threads/${rootId}`;

			window.open(href, "_blank", "noopener,noreferrer");
		},
		[orgSlug, conversationId, threadHref, threadTabsKey],
	);

	const handleOpenThreadInNewTab = useCallback(
		(message: Message) => {
			openThreadTab(message.id, toOpenThreadTab(message));
		},
		[openThreadTab],
	);

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
	 * Mark read only while visible. The hook owns the refs so the effect does
	 * not re-run on every render, and a failed request clears the marker so a
	 * later render can retry.
	 */
	const newestId = messages[messages.length - 1]?.id ?? null;
	useConversationReadOnVisible(newestId, markRead);

	const conversation = detail.data?.conversation ?? null;
	const scope = conversation?.scope ?? "direct";
	const name =
		scope === "project"
			? (projectName ?? conversation?.title ?? "Project messages")
			: scope === "group"
				? (conversation?.title ?? "Channel")
				: (counterpart?.name ?? "Conversation");

	// A channel can have several typers, so the header names one, two, or says
	// several. A direct chat only ever has the other person.
	const typingNames = typingUsers
		.map(
			(userId) =>
				conversation?.participants.find(
					(participant) => participant.userId === userId,
				)?.name ?? "",
		)
		.filter((value) => value.length > 0);
	const typingLabel =
		typingNames.length === 0
			? null
			: typingNames.length === 1
				? `${typingNames[0]} is typing...`
				: typingNames.length === 2
					? `${typingNames[0]} and ${typingNames[1]} are typing...`
					: "Several people are typing...";

	const privacy =
		scope === "group" && conversation?.visibility === "private"
			? ", private"
			: "";
	const status =
		typingLabel ??
		(scope === "group"
			? conversation?.archivedAt
				? `Archived${privacy}`
				: `${conversation?.memberCount ?? 0} members${privacy}`
			: scope === "project"
				? conversation?.archivedAt
					? "Archived"
					: `${conversation?.memberCount ?? 0} members`
				: counterpart && !counterpart.isMember
					? "No longer in this workspace"
					: "Direct message");

	const threadPanel = activeThreadId ? (
		<ThreadPanel
			key={activeThreadId}
			orgSlug={orgSlug}
			conversationId={conversationId}
			organizationId={organizationId}
			rootId={activeThreadId}
			viewerId={viewerId}
			jumpMessageId={threadJumpId}
			focusToken={replyFocusToken}
			autoFocus={threadFocusOnOpen}
			onClose={() => {
				setActiveThreadId(null);
				setThreadJumpId(null);
				setReplyFocusToken(0);
			}}
			onOpenThread={(root) =>
				openThreadTab(activeThreadId, root ? toOpenThreadTab(root) : undefined)
			}
		/>
	) : null;

	const conversationColumn = (
		<div className="flex h-full min-w-0 flex-1 flex-col">
			<header className="flex h-14 shrink-0 items-center gap-3 border-b border-app-border px-4">
				<ConversationIdentity
					name={name}
					image={counterpart?.image ?? null}
					scope={scope}
					status={status}
				/>

				{scope === "group" && conversation && (
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="Channel settings"
						onPress={() => setSettingsOpen(true)}
					>
						<Settings2Icon aria-hidden />
					</Button>
				)}

				{jumped && (
					<Button
						variant="outline"
						size="sm"
						onPress={() => {
							setHighlightId(null);
							setJumped(false);
							void queryClient.resetQueries({
								queryKey: conversationMessagesKey(orgSlug, conversationId),
							});
						}}
					>
						<ArrowDownIcon aria-hidden />
						Latest
					</Button>
				)}

				<ConversationSearch
					value={search}
					onValueChange={setSearch}
					results={searchResults.data?.results ?? []}
					isPending={searchResults.isPending}
					isError={searchResults.isError}
					onSelect={handleSearchSelect}
				/>
			</header>

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
					onReply={handleReply}
					onOpenThreadInNewTab={handleOpenThreadInNewTab}
					activeThreadId={activeThreadId}
					highlightId={highlightId}
				/>
			)}

			<div className="shrink-0 px-4 pt-2 pb-4">
				{scope === "group" && conversation?.archivedAt ? (
					<p className="text-xs text-app-text-muted">
						This channel is archived, so it is read only. An owner can restore
						it from channel settings.
					</p>
				) : scope === "project" && conversation?.archivedAt ? (
					<p className="text-xs text-app-text-muted">
						This project is archived, so it is read only. Restore the project to
						continue.
					</p>
				) : counterpart && !counterpart.isMember ? (
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
						placeholder={
							scope === "group" ? `Message #${name}` : `Message ${name}`
						}
					/>
				)}
			</div>
		</div>
	);

	return (
		<div className="relative flex h-full min-h-0">
			{activeThreadId && isDesktop ? (
				<ResizablePanelGroup
					orientation="horizontal"
					defaultLayout={layout.defaultLayout}
					onLayoutChanged={layout.onLayoutChanged}
					className="min-h-0"
				>
					<ResizablePanel id="conversation" minSize="35%">
						{conversationColumn}
					</ResizablePanel>

					<ResizableHandle withHandle />

					<ResizablePanel
						id="thread"
						defaultSize="380px"
						minSize="280px"
						maxSize="55%"
					>
						{threadPanel}
					</ResizablePanel>
				</ResizablePanelGroup>
			) : (
				<>
					{conversationColumn}

					{activeThreadId && (
						<div className="absolute inset-0 z-20 md:hidden">{threadPanel}</div>
					)}
				</>
			)}

			{scope === "group" && conversation && (
				<ChannelSettingsDialog
					key={conversation.id}
					orgSlug={orgSlug}
					conversation={conversation}
					viewerId={viewerId}
					isOpen={settingsOpen}
					onOpenChange={setSettingsOpen}
				/>
			)}
		</div>
	);
}
