"use client";

/**
 * The messages empty state.
 *
 * Why it points at the sidebar: the conversation list now lives in the primary
 * rail, so this pane is only ever the chat itself. The empty state explains
 * that and offers the one action that is useful here, starting a new message.
 *
 * Used by: routes/_app/$orgSlug.messages.index.tsx.
 */

import { Button } from "@org/ui/components/button";
import { MessageSquareIcon, MessageSquarePlusIcon } from "lucide-react";
import { useState } from "react";

import { NewConversationDialog } from "./new-conversation-dialog";

export function MessagesEmptyState({ orgSlug }: { orgSlug: string }) {
	const [dialogOpen, setDialogOpen] = useState(false);

	return (
		<div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
			<MessageSquareIcon aria-hidden className="size-8 text-app-text-muted" />
			<p className="text-sm font-medium text-app-text">Select a conversation</p>
			<p className="max-w-xs text-xs text-app-text-muted">
				Your chats are in the sidebar. Pick one, or start a new message.
			</p>
			<Button size="sm" onPress={() => setDialogOpen(true)}>
				<MessageSquarePlusIcon aria-hidden />
				New message
			</Button>

			<NewConversationDialog
				orgSlug={orgSlug}
				isOpen={dialogOpen}
				onOpenChange={setDialogOpen}
			/>
		</div>
	);
}
