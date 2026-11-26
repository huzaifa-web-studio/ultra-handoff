"use client";

/**
 * One direct conversation row in the sidebar.
 *
 * Why its own file: the rail now holds a channels section and a direct message
 * section. Keeping each row kind separate stops the two unread and typing rules
 * from growing into one component.
 *
 * Used by: components/app-sidebar/nav-messages.tsx.
 */

import { Avatar, AvatarFallback, AvatarImage } from "@org/ui/components/avatar";
import { SidebarMenuButton, SidebarMenuItem } from "@org/ui/components/sidebar";
import { useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import type * as React from "react";
import type { ConversationSummary } from "#/features/messages/api";
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

export function NavDirectRow({
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
	// An empty chat is a real chat the person just opened. Say so instead of
	// the generic "No messages yet", which reads like the row is broken.
	const preview = time
		? conversation.lastMessage.preview || "No messages yet"
		: "New conversation";
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
