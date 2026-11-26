"use client";

/**
 * The messages layout.
 *
 * Why the list moved to the primary sidebar: the app already has a rail that
 * lists projects and navigation. Keeping a second conversation list inside this
 * page duplicated that job and cost the chat a third of its width. The sidebar
 * owns the list now, so this route is a single full width pane.
 *
 * The layout still owns the realtime subscription, because the sidebar list and
 * the open conversation both react to the same personal stream.
 *
 * Used by: routes/_app/$orgSlug.messages.tsx.
 */

import { Outlet, useLocation } from "@tanstack/react-router";

import { authClient } from "#/features/auth/client";
import { useMessagesRealtime } from "./realtime";

/** Read the conversation and thread ids out of the current path. */
function activeMessageRoute(pathname: string): {
	conversationId: string | null;
	threadId: string | null;
} {
	const thread = /\/messages\/([^/]+)\/threads\/([^/]+)$/.exec(pathname);

	if (thread?.[1] && thread[2]) {
		return {
			conversationId: safeDecode(thread[1]),
			threadId: safeDecode(thread[2]),
		};
	}

	const conversation = /\/messages\/([^/]+)$/.exec(pathname);

	return {
		conversationId: conversation?.[1] ? safeDecode(conversation[1]) : null,
		threadId: null,
	};
}

/** Decode a path segment, falling back to the raw value. */
function safeDecode(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

export function MessagesShell({ orgSlug }: { orgSlug: string }) {
	const { pathname } = useLocation();
	const { data: session } = authClient.useSession();
	const route = activeMessageRoute(pathname);

	useMessagesRealtime({
		orgSlug,
		viewerId: session?.user.id ?? "",
		activeConversationId: route.conversationId,
		activeThreadId: route.threadId,
	});

	return (
		/*
		 * The shell negates the page padding so the chat fills the content area.
		 * The height is the viewport minus the fixed app header, which is what
		 * gives the thread a real scroll container.
		 */
		<div className="-m-8 flex h-[calc(100svh-3.5rem)] min-h-0 overflow-hidden bg-app-panel">
			<section className="flex min-w-0 flex-1 flex-col">
				<Outlet />
			</section>
		</div>
	);
}
