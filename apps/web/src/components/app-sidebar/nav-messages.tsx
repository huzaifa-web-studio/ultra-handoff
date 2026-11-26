"use client";

/**
 * The messages section in the primary sidebar.
 *
 * Why two sections: a channel is a named room the reader joins, and a direct
 * message is a private pair. They have different discovery rules, empty states
 * and management actions, so the rail shows Channels then Direct messages. A
 * joined channel appears even with no messages, which is the one behaviour the
 * activity ordered list could not express.
 *
 * The list lives in the rail so the conversation owns the full page width. The
 * realtime subscription lives in the messages layout and patches both queries.
 *
 * Used by: components/app-sidebar/app-sidebar.tsx.
 */

import {
	SidebarGroup,
	SidebarGroupAction,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@org/ui/components/sidebar";
import { useLocation } from "@tanstack/react-router";
import {
	ArchiveIcon,
	HashIcon,
	MessageSquarePlusIcon,
	PlusIcon,
} from "lucide-react";
import { useState } from "react";
import { flattenConversations } from "#/features/messages/cache";
import { ChannelDialog } from "#/features/messages/channel-dialog";
import {
	useArchivedChannels,
	useChannels,
	useConversation,
	useConversations,
} from "#/features/messages/hooks";
import { NewConversationDialog } from "#/features/messages/new-conversation-dialog";
import { NavChannelRow } from "./nav-channel-row";
import { NavDirectRow } from "./nav-direct-row";

/** Read the conversation id out of a messages path, or null. */
function activeConversationId(pathname: string): string | null {
	const match = /\/messages\/([^/]+)/.exec(pathname);
	const value = match?.[1];

	if (!value) return null;

	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

/** A compact unread badge for a section label. */
function SectionBadge({ count }: { count: number }) {
	if (count <= 0) return null;

	return (
		<span className="ml-auto bg-app-attention px-1.5 py-0.5 text-[0.6rem] font-semibold tabular-nums text-app-attention-text">
			{count > 99 ? "99+" : count}
			<span className="sr-only"> unread</span>
		</span>
	);
}

export function NavMessages({ orgSlug }: { orgSlug: string }) {
	const { pathname } = useLocation();
	const channels = useChannels(orgSlug);
	const archived = useArchivedChannels(orgSlug);
	const conversations = useConversations(orgSlug);
	const rows = flattenConversations(conversations.data);
	const channelRows = channels.data?.channels ?? [];
	const archivedRows = archived.data?.channels ?? [];
	const channelUnread = channels.data?.unreadTotal ?? 0;
	const dmUnread = conversations.data?.pages[0]?.unreadTotal ?? 0;
	const [channelDialogOpen, setChannelDialogOpen] = useState(false);
	const [dialogOpen, setDialogOpen] = useState(false);
	const base = `/${orgSlug}/messages`;

	/*
	 * An empty direct conversation is intentionally absent from the list query,
	 * because a list of chats with no messages is noise. The catch is the person
	 * who just opened one from the picker: the rail said "No conversations yet"
	 * while the chat was on screen. The open conversation is therefore shown as
	 * a temporary row until its first message makes it a real list entry.
	 * Channels do not need this, because their list includes empty rows.
	 */
	const openId = activeConversationId(pathname);
	const openDetail = useConversation(orgSlug, openId ?? "");
	const openConversation = openDetail.data?.conversation ?? null;
	const draftRow =
		openConversation &&
		openConversation.scope === "direct" &&
		openConversation.lastMessage.createdAt === null &&
		!rows.some((row) => row.id === openConversation.id)
			? openConversation
			: null;

	/** True when the channel or chat in the path is this id. */
	function isActive(id: string): boolean {
		return (
			pathname === `${base}/${id}` || pathname.startsWith(`${base}/${id}/`)
		);
	}

	return (
		<>
			<SidebarGroup>
				<SidebarGroupLabel>
					Channels
					<SectionBadge count={channelUnread} />
				</SidebarGroupLabel>

				<SidebarGroupAction
					aria-label="Create or browse channels"
					title="Create or browse channels"
					onClick={() => setChannelDialogOpen(true)}
				>
					<PlusIcon aria-hidden />
				</SidebarGroupAction>

				{channelRows.length > 0 && (
					<SidebarMenu>
						{channelRows.map((channel) => (
							<NavChannelRow
								key={channel.id}
								orgSlug={orgSlug}
								channel={channel}
								active={isActive(channel.id)}
							/>
						))}
					</SidebarMenu>
				)}

				{channels.isPending ? (
					<p className="px-3 py-2 text-xs text-sidebar-foreground/60">
						Loading channels...
					</p>
				) : channelRows.length === 0 ? (
					<div className="flex flex-col items-start gap-1 px-3 py-2">
						<p className="text-xs text-sidebar-foreground/60">
							No channels yet.
						</p>
						<button
							type="button"
							onClick={() => setChannelDialogOpen(true)}
							className="inline-flex items-center gap-1 text-xs font-medium text-sidebar-primary hover:underline focus-visible:underline focus-visible:outline-none"
						>
							<HashIcon aria-hidden className="size-3" />
							Browse or create a channel
						</button>
					</div>
				) : null}

				{channels.data?.truncated && (
					<p className="px-3 py-1 text-[0.65rem] text-sidebar-foreground/50">
						Showing the first {channelRows.length} channels.
					</p>
				)}
			</SidebarGroup>

			{archivedRows.length > 0 && (
				<SidebarGroup>
					<SidebarGroupLabel>
						<ArchiveIcon aria-hidden className="size-3" />
						Archived
					</SidebarGroupLabel>

					<SidebarMenu>
						{archivedRows.map((channel) => (
							<NavChannelRow
								key={channel.id}
								orgSlug={orgSlug}
								channel={channel}
								active={isActive(channel.id)}
							/>
						))}
					</SidebarMenu>

					{archived.data?.truncated && (
						<p className="px-3 py-1 text-[0.65rem] text-sidebar-foreground/50">
							Showing the first {archivedRows.length} archived channels.
						</p>
					)}
				</SidebarGroup>
			)}

			<SidebarGroup>
				<SidebarGroupLabel>
					Direct messages
					<SectionBadge count={dmUnread} />
				</SidebarGroupLabel>

				{/*
				 * The compose action sits in the section header, which is where a
				 * chat rail normally puts it. It stays reachable when the list
				 * grows long.
				 */}
				<SidebarGroupAction
					aria-label="New message"
					title="New message"
					onClick={() => setDialogOpen(true)}
				>
					<MessageSquarePlusIcon aria-hidden />
				</SidebarGroupAction>

				{(rows.length > 0 || draftRow) && (
					<SidebarMenu>
						{draftRow && (
							<NavDirectRow
								key={draftRow.id}
								orgSlug={orgSlug}
								conversation={draftRow}
								active
							/>
						)}
						{rows.map((conversation) => (
							<NavDirectRow
								key={conversation.id}
								orgSlug={orgSlug}
								conversation={conversation}
								active={isActive(conversation.id)}
							/>
						))}
					</SidebarMenu>
				)}

				{conversations.isPending ? (
					<p className="px-3 py-2 text-xs text-sidebar-foreground/60">
						Loading conversations...
					</p>
				) : rows.length === 0 && !draftRow ? (
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
			</SidebarGroup>

			<ChannelDialog
				orgSlug={orgSlug}
				isOpen={channelDialogOpen}
				onOpenChange={setChannelDialogOpen}
			/>

			<NewConversationDialog
				orgSlug={orgSlug}
				isOpen={dialogOpen}
				onOpenChange={setDialogOpen}
			/>
		</>
	);
}
