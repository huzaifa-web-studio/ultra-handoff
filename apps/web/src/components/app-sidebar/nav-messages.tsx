"use client";

/**
 * The messages section in the app sidebar.
 *
 * Why recent chats and not the whole directory: a workspace can hold a hundred
 * people, and a rail of every name is not navigation. The six most recent
 * conversations are one click away, the Messages row opens the full list, and
 * the picker inside the page finds anyone else.
 *
 * Used by: components/app-sidebar/app-sidebar.tsx.
 */

import { Avatar, AvatarFallback, AvatarImage } from "@org/ui/components/avatar";
import {
	SidebarGroup,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@org/ui/components/sidebar";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { MessageSquareIcon } from "lucide-react";
import type * as React from "react";

import { flattenConversations } from "#/features/messages/cache";
import { useConversations } from "#/features/messages/hooks";

/** Initials for an avatar fallback. */
function initials(name: string): string {
	const parts = name.trim().split(/\s+/).slice(0, 2);

	return parts.map((part) => part.charAt(0).toUpperCase()).join("") || "?";
}

/** How many recent chats the rail shows. */
const RECENT_LIMIT = 6;

export function NavMessages({ orgSlug }: { orgSlug: string }) {
	const navigate = useNavigate();
	const { pathname } = useLocation();
	const conversations = useConversations(orgSlug);
	const rows = flattenConversations(conversations.data).slice(0, RECENT_LIMIT);
	const unreadTotal = conversations.data?.pages[0]?.unreadTotal ?? 0;
	const base = `/${orgSlug}/messages`;

	function go(event: React.MouseEvent, target: string): void {
		event.preventDefault();
		void navigate({ to: target });
	}

	return (
		<SidebarGroup>
			<SidebarGroupLabel>Messages</SidebarGroupLabel>
			<SidebarMenu>
				<SidebarMenuItem>
					<SidebarMenuButton
						href={base}
						isActive={pathname === base}
						tooltip="Messages"
						onClick={(event: React.MouseEvent) => go(event, base)}
					>
						<MessageSquareIcon />
						<span>Messages</span>
						{unreadTotal > 0 && (
							<span className="ml-auto bg-app-attention px-1.5 py-0.5 text-[0.6rem] font-semibold tabular-nums text-app-attention-text">
								{unreadTotal > 99 ? "99+" : unreadTotal}
								<span className="sr-only"> unread</span>
							</span>
						)}
					</SidebarMenuButton>
				</SidebarMenuItem>

				{rows.map((conversation) => {
					const name = conversation.counterpart?.name ?? "Conversation";
					const href = `${base}/${conversation.id}`;

					return (
						<SidebarMenuItem key={conversation.id}>
							<SidebarMenuButton
								href={href}
								isActive={pathname === href}
								tooltip={name}
								onClick={(event: React.MouseEvent) => go(event, href)}
							>
								<Avatar size="sm">
									{conversation.counterpart?.image && (
										<AvatarImage src={conversation.counterpart.image} alt="" />
									)}
									<AvatarFallback>{initials(name)}</AvatarFallback>
								</Avatar>
								<span className="truncate">{name}</span>
								{conversation.unread > 0 && (
									<span className="ml-auto bg-app-attention px-1.5 py-0.5 text-[0.6rem] font-semibold tabular-nums text-app-attention-text">
										{conversation.unread > 99 ? "99+" : conversation.unread}
										<span className="sr-only"> unread</span>
									</span>
								)}
							</SidebarMenuButton>
						</SidebarMenuItem>
					);
				})}
			</SidebarMenu>
		</SidebarGroup>
	);
}
