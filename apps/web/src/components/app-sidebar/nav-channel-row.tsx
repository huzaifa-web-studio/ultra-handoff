"use client";

/**
 * One channel row in the sidebar.
 *
 * A channel is a named room, so it shows a hash instead of a person avatar.
 * Typing can come from several people at once, so the preview says how many
 * instead of naming one. A muted row still counts unread and only loses the
 * bell, matching the notification rule on the server.
 *
 * Used by: components/app-sidebar/nav-messages.tsx.
 */

import { SidebarMenuButton, SidebarMenuItem } from "@org/ui/components/sidebar";
import { useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import { ArchiveIcon, BellOffIcon, HashIcon, LockIcon } from "lucide-react";
import type * as React from "react";
import type { ChannelSummary } from "#/features/messages/api";
import { formatCommentTime } from "#/lib/date";
import {
	conversationChannel,
	useTypingUsers,
} from "#/lib/realtime/typing-store";

/** Human copy for the typing line. */
function typingLabel(count: number): string {
	if (count <= 1) return "typing...";

	return `${count} people typing...`;
}

export function NavChannelRow({
	orgSlug,
	channel,
	active,
}: {
	orgSlug: string;
	channel: ChannelSummary;
	active: boolean;
}) {
	const navigate = useNavigate();
	const typing = useTypingUsers(conversationChannel(channel.id));
	const name = channel.title ?? "Untitled channel";
	const href = `/${orgSlug}/messages/${channel.id}`;
	const time = channel.lastMessage.createdAt;
	const preview = time
		? channel.lastMessage.preview || "No messages yet"
		: "No messages yet";
	const archived = channel.archivedAt !== null;
	const unread = channel.unread > 0 && !archived;

	return (
		<SidebarMenuItem>
			<SidebarMenuButton
				href={href}
				isActive={active}
				tooltip={`#${name}`}
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
				<span className="relative mt-0.5 flex size-7 shrink-0 items-center justify-center border border-sidebar-border text-sidebar-foreground/70">
					<HashIcon aria-hidden className="size-3.5" />
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
						{channel.visibility === "private" && (
							<LockIcon
								aria-label="Private channel"
								className="size-3 shrink-0 text-sidebar-foreground/50"
							/>
						)}
						{archived && (
							<ArchiveIcon
								aria-label="Archived"
								className="size-3 shrink-0 text-sidebar-foreground/50"
							/>
						)}
						{channel.muted && (
							<BellOffIcon
								aria-label="Muted"
								className="size-3 shrink-0 text-sidebar-foreground/50"
							/>
						)}
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
							typing.length > 0
								? "text-sidebar-primary"
								: unread
									? "text-sidebar-foreground/80"
									: "text-sidebar-foreground/55",
						)}
					>
						{typing.length > 0 ? typingLabel(typing.length) : preview}
					</span>
				</span>

				{unread && (
					<span className="ml-1 shrink-0 self-center bg-app-attention px-1.5 py-0.5 text-[0.6rem] font-semibold tabular-nums text-app-attention-text">
						{channel.unread > 99 ? "99+" : channel.unread}
						<span className="sr-only"> unread</span>
					</span>
				)}
			</SidebarMenuButton>
		</SidebarMenuItem>
	);
}
