"use client";

/**
 * The conversation list.
 *
 * Why this component owns the list and the picker: a chat app needs the list
 * visible while a conversation is open, and the "new message" action belongs
 * next to it. Keeping both here means the sidebar section and the messages page
 * render the same rows.
 *
 * The list is ordered by activity on the server. A realtime message moves its
 * row to the top through the cache reducer, so the order stays correct without
 * a refetch.
 *
 * Used by: messages-shell.tsx and the sidebar messages section.
 */

import { Avatar, AvatarFallback, AvatarImage } from "@org/ui/components/avatar";
import { Button } from "@org/ui/components/button";
import { Input } from "@org/ui/components/input";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { MessageSquarePlusIcon, SearchIcon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { formatCommentTime, formatDateTime } from "#/lib/date";
import {
	conversationChannel,
	useTypingUser,
} from "#/lib/realtime/typing-store";
import type { ConversationSummary } from "./api";
import { flattenConversations } from "./cache";
import { useConversations } from "./hooks";
import { NewConversationDialog } from "./new-conversation-dialog";

/** Initials for an avatar fallback. */
function initials(name: string): string {
	const parts = name.trim().split(/\s+/).slice(0, 2);

	return parts.map((part) => part.charAt(0).toUpperCase()).join("") || "?";
}

/** One row in the list. */
export function ConversationRow({
	orgSlug,
	conversation,
	active,
}: {
	orgSlug: string;
	conversation: ConversationSummary;
	active: boolean;
}) {
	const typingUserId = useTypingUser(conversationChannel(conversation.id));
	const name = conversation.counterpart?.name ?? "Conversation";
	const image = conversation.counterpart?.image ?? null;
	const preview = conversation.lastMessage.preview;
	const time = conversation.lastMessage.createdAt;

	return (
		<Link
			to="/$orgSlug/messages/$conversationId"
			params={{ orgSlug, conversationId: conversation.id }}
			aria-current={active ? "page" : undefined}
			className={cn(
				"flex items-center gap-3 border-b border-app-border px-3 py-2.5 transition-colors",
				active
					? "bg-app-selected"
					: "hover:bg-app-panel-subtle focus-visible:bg-app-selected",
				"focus-visible:outline-none",
			)}
		>
			<Avatar>
				{image && <AvatarImage src={image} alt="" />}
				<AvatarFallback>{initials(name)}</AvatarFallback>
			</Avatar>

			<span className="min-w-0 flex-1">
				<span className="flex items-baseline gap-2">
					<span className="truncate text-sm font-medium text-app-text">
						{name}
					</span>
					{time && (
						<span
							className="ml-auto shrink-0 text-[0.65rem] text-app-text-muted"
							title={formatDateTime(time)}
						>
							{formatCommentTime(time)}
						</span>
					)}
				</span>
				<span className="flex items-center gap-2">
					<span
						className={cn(
							"truncate text-xs",
							typingUserId
								? "text-app-focus"
								: conversation.unread > 0
									? "font-medium text-app-text"
									: "text-app-text-muted",
						)}
					>
						{typingUserId ? "typing..." : preview || "No messages yet"}
					</span>
					{conversation.unread > 0 && (
						<span className="ml-auto shrink-0 bg-app-attention px-1.5 py-0.5 text-[0.6rem] font-semibold tabular-nums text-app-attention-text">
							{conversation.unread > 99 ? "99+" : conversation.unread}
							<span className="sr-only"> unread</span>
						</span>
					)}
				</span>
			</span>

			{!conversation.counterpart?.isMember && (
				<span className="sr-only">Former member</span>
			)}
		</Link>
	);
}

export function ConversationList({
	orgSlug,
	activeId,
	limit,
	className,
}: {
	orgSlug: string;
	/** The conversation currently on screen, if any. */
	activeId: string | null;
	/** Optional cap, used by the sidebar section. */
	limit?: number;
	className?: string;
}) {
	const conversations = useConversations(orgSlug);
	const [search, setSearch] = useState("");
	const [dialogOpen, setDialogOpen] = useState(false);
	const rows = flattenConversations(conversations.data);

	const filtered = useMemo(() => {
		const term = search.trim().toLowerCase();
		const base = term
			? rows.filter((row) => {
					const name = row.counterpart?.name ?? "";
					const preview = row.lastMessage.preview;

					return (
						name.toLowerCase().includes(term) ||
						preview.toLowerCase().includes(term)
					);
				})
			: rows;

		return limit ? base.slice(0, limit) : base;
	}, [rows, search, limit]);

	return (
		<div className={cn("flex min-h-0 flex-col", className)}>
			<div className="flex items-center gap-2 border-b border-app-border px-3 py-2">
				{limit ? (
					<h2 className="text-xs font-semibold tracking-wide text-app-text-muted uppercase">
						Messages
					</h2>
				) : (
					<div className="relative flex-1">
						<SearchIcon
							aria-hidden
							className="pointer-events-none absolute top-1/2 left-0 size-3.5 -translate-y-1/2 text-app-text-muted"
						/>
						<Input
							type="search"
							value={search}
							onChange={(event) => setSearch(event.target.value)}
							placeholder="Search chats"
							aria-label="Search chats"
							className="h-8 pl-6"
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
				)}

				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="New message"
					onPress={() => setDialogOpen(true)}
					className="shrink-0"
				>
					<MessageSquarePlusIcon aria-hidden />
				</Button>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto">
				{conversations.isPending ? (
					<p className="p-4 text-sm text-app-text-muted">
						Loading conversations...
					</p>
				) : conversations.isError ? (
					<div className="flex flex-col gap-2 p-4">
						<p role="alert" className="text-sm text-danger">
							Could not load your conversations.
						</p>
						<Button
							variant="outline"
							size="sm"
							onPress={() => void conversations.refetch()}
						>
							Try again
						</Button>
					</div>
				) : filtered.length === 0 ? (
					<div className="flex flex-col items-start gap-2 p-4">
						<p className="text-sm text-app-text-muted">
							{rows.length === 0
								? "No conversations yet."
								: "No chat matches that search."}
						</p>
						{rows.length === 0 && (
							<Button
								variant="outline"
								size="sm"
								onPress={() => setDialogOpen(true)}
							>
								<MessageSquarePlusIcon aria-hidden />
								Start a conversation
							</Button>
						)}
					</div>
				) : (
					<>
						{filtered.map((conversation) => (
							<ConversationRow
								key={conversation.id}
								orgSlug={orgSlug}
								conversation={conversation}
								active={conversation.id === activeId}
							/>
						))}

						{!limit && !search.trim() && conversations.hasNextPage && (
							<div className="p-2">
								<Button
									variant="ghost"
									size="sm"
									className="w-full"
									loading={conversations.isFetchingNextPage}
									onPress={() => void conversations.fetchNextPage()}
								>
									Load older conversations
								</Button>
							</div>
						)}
					</>
				)}
			</div>

			<NewConversationDialog
				orgSlug={orgSlug}
				isOpen={dialogOpen}
				onOpenChange={setDialogOpen}
			/>
		</div>
	);
}
