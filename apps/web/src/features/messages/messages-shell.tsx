"use client";

/**
 * The messages layout.
 *
 * Why the list lives in the layout and the conversation in an outlet: the list
 * must stay visible while a chat is open, and the open chat must be its own URL
 * so it can be opened in a new browser tab or reached from a notification.
 *
 * Below `md` the layout becomes one pane. The URL decides which pane is shown,
 * so the browser back button closes the chat.
 *
 * Used by: routes/_app/$orgSlug.messages.tsx.
 */

import { Outlet, useLocation } from "@tanstack/react-router";
import { cn } from "cn";

import { authClient } from "#/features/auth/client";
import { ConversationList } from "./conversation-list";
import { useMessagesRealtime } from "./realtime";

/** Read the conversation id out of the current path, if there is one. */
function activeConversationId(pathname: string): string | null {
	const match = /\/messages\/([^/]+)$/.exec(pathname);

	if (!match?.[1]) return null;

	try {
		return decodeURIComponent(match[1]);
	} catch {
		return match[1];
	}
}

export function MessagesShell({ orgSlug }: { orgSlug: string }) {
	const { pathname } = useLocation();
	const { data: session } = authClient.useSession();
	const activeId = activeConversationId(pathname);

	// One subscription for the list, the thread and the badge.
	useMessagesRealtime({
		orgSlug,
		viewerId: session?.user.id ?? "",
		activeConversationId: activeId,
	});

	return (
		/*
		 * The shell negates the page padding so the chat fills the content area.
		 * The height is the viewport minus the fixed app header, which is what
		 * gives the thread a real scroll container.
		 */
		<div className="-m-8 flex h-[calc(100svh-3.5rem)] min-h-0 overflow-hidden bg-app-panel">
			<aside
				aria-label="Conversations"
				className={cn(
					"w-full shrink-0 flex-col border-r border-app-border md:flex md:w-80",
					activeId ? "hidden" : "flex",
				)}
			>
				<ConversationList
					orgSlug={orgSlug}
					activeId={activeId}
					className="h-full"
				/>
			</aside>

			<section
				className={cn(
					"min-w-0 flex-1 flex-col",
					activeId ? "flex" : "hidden md:flex",
				)}
			>
				<Outlet />
			</section>
		</div>
	);
}
