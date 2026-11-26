"use client";

/**
 * The messages section in the primary sidebar.
 *
 * Why the whole list lives here: the user asked for one conversation surface,
 * the same shape ClickUp uses. The sidebar is the only list, and the messages
 * page is a single full width chat. That removes the inner list pane and gives
 * the conversation the space it needs.
 *
 * Each row shows the other person, the newest preview, the time and the unread
 * count. Typing replaces the preview, so a row never needs a second badge. An
 * unread row brightens and carries a dot on the avatar, which is what makes a
 * long list scannable.
 *
 * Used by: components/app-sidebar/app-sidebar.tsx.
 */

import { Avatar, AvatarFallback, AvatarImage } from "@org/ui/components/avatar";
import {
	SidebarGroup,
	SidebarGroupAction,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@org/ui/components/sidebar";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import { MessageSquarePlusIcon } from "lucide-react";
import type * as React from "react";
import { useState } from "react";
import type { ConversationSummary } from "#/features/messages/api";
import { flattenConversations } from "#/features/messages/cache";
import { useConversations } from "#/features/messages/hooks";
import { NewConversationDialog } from "#/features/messages/new-conversation-dialog";
import { formatCommentTime } from "#/lib/date";
import {
	conversationChannel,
	useTypingUser,
} from "#/lib/realtime/typing-store";

/** Initials for an avatar fallback. */
function initials(name: string): string {
	const parts = name.trim().split(/\s+/).slice(0, 2);

	return parts.map((part) => part.charAt(0).toUpperCase()).join("") || "?";
}

/** One conversation row in the rail. */
function SidebarConversationRow({
	orgSlug,
	conversation,
	active,
}: {
	orgSlug: string;
	conversation: ConversationSummary;
	active: boolean;
}) {
	const navigate = useNavigate();
	const typingUserId = useTypingUser(conversationChannel(conversation.id));
	const name = conversation.counterpart?.name ?? "Conversation";
	const href = `/${orgSlug}/messages/${conversation.id}`;
	const time = conversation.lastMessage.createdAt;
	const preview = conversation.lastMessage.preview || "No messages yet";
	const unread = conversation.unread > 0;

	return (
		<SidebarMenuItem>
			<SidebarMenuButton
				href={href}
				isActive={active}
				tooltip={name}
				onClick={(event: React.MouseEvent) => {
					event.preventDefault();
					void navigate({ to: href });
				}}
				className={cn(
					"h-auto items-start gap-2 py-1.5",
					active && "bg-sidebar-accent/70",
					unread && "text-sidebar-foreground",
				)}
			>
				<span className="relative mt-0.5 shrink-0">
					<Avatar size="sm">
						{conversation.counterpart?.image && (
							<AvatarImage src={conversation.counterpart.image} alt="" />
						)}
						<AvatarFallback>{initials(name)}</AvatarFallback>
					</Avatar>
					{unread && (
						<span
							aria-hidden
							className="absolute -right-0.5 -bottom-0.5 size-2.5 border-2 border-sidebar bg-app-attention"
						/>
					)}
				</span>

				<span className="flex min-w-0 flex-1 flex-col gap-0.5">
					<span className="flex items-baseline gap-2">
						<span
							className={cn(
								"truncate text-sm",
								active
									? "font-semibold text-sidebar-primary"
									: unread
										? "font-semibold text-sidebar-foreground"
										: "font-medium text-sidebar-foreground/80",
							)}
						>
							{name}
						</span>
						{time && (
							<span
								className={cn(
									"ml-auto shrink-0 text-[0.6rem] tabular-nums",
									unread
										? "text-sidebar-foreground/80"
										: "text-sidebar-foreground/50",
								)}
							>
								{formatCommentTime(time)}
							</span>
						)}
					</span>
					<span
						className={cn(
							"truncate text-xs",
							typingUserId
								? "text-sidebar-primary"
								: unread
									? "text-sidebar-foreground/80"
									: "text-sidebar-foreground/55",
						)}
					>
						{typingUserId ? "typing..." : preview}
					</span>
				</span>

				{unread && (
					<span className="ml-1 shrink-0 self-center bg-app-attention px-1.5 py-0.5 text-[0.6rem] font-semibold tabular-nums text-app-attention-text">
						{conversation.unread > 99 ? "99+" : conversation.unread}
						<span className="sr-only"> unread</span>
					</span>
				)}
			</SidebarMenuButton>
		</SidebarMenuItem>
	);
}

export function NavMessages({ orgSlug }: { orgSlug: string }) {
	const { pathname } = useLocation();
	const conversations = useConversations(orgSlug);
	const rows = flattenConversations(conversations.data);
	const unreadTotal = conversations.data?.pages[0]?.unreadTotal ?? 0;
	const [dialogOpen, setDialogOpen] = useState(false);
	const base = `/${orgSlug}/messages`;

	return (
		<SidebarGroup>
			<SidebarGroupLabel>
				Messages
				{unreadTotal > 0 && (
					<span className="ml-auto bg-app-attention px-1.5 py-0.5 text-[0.6rem] font-semibold tabular-nums text-app-attention-text">
						{unreadTotal > 99 ? "99+" : unreadTotal}
						<span className="sr-only"> unread</span>
					</span>
				)}
			</SidebarGroupLabel>

			{/*
			 * The compose action sits in the section header, which is where a chat
			 * rail normally puts it. It stays reachable when the list grows long.
			 */}
			<SidebarGroupAction
				aria-label="New message"
				title="New message"
				onClick={() => setDialogOpen(true)}
			>
				<MessageSquarePlusIcon aria-hidden />
			</SidebarGroupAction>

			{rows.length > 0 && (
				<SidebarMenu>
					{rows.map((conversation) => (
						<SidebarConversationRow
							key={conversation.id}
							orgSlug={orgSlug}
							conversation={conversation}
							active={
								pathname === base ||
								pathname.startsWith(`${base}/${conversation.id}`)
							}
						/>
					))}
				</SidebarMenu>
			)}

			{conversations.isPending ? (
				<p className="px-3 py-2 text-xs text-sidebar-foreground/60">
					Loading conversations...
				</p>
			) : rows.length === 0 ? (
				<div className="flex flex-col items-start gap-1 px-3 py-2">
					<p className="text-xs text-sidebar-foreground/60">
						No conversations yet.
					</p>
					<button
						type="button"
						onClick={() => setDialogOpen(true)}
						className="text-xs font-medium text-sidebar-primary hover:underline focus-visible:underline focus-visible:outline-none"
					>
						Start a conversation
					</button>
				</div>
			) : null}

			{conversations.hasNextPage && (
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton
							size="sm"
							tooltip="Load older conversations"
							isDisabled={conversations.isFetchingNextPage}
							onClick={() => void conversations.fetchNextPage()}
						>
							<span>Load older conversations</span>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			)}

			<NewConversationDialog
				orgSlug={orgSlug}
				isOpen={dialogOpen}
				onOpenChange={setDialogOpen}
			/>
		</SidebarGroup>
	);
}
