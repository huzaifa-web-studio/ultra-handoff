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
import {
	HashIcon,
	MessageSquareIcon,
	MessageSquarePlusIcon,
} from "lucide-react";
import { useState } from "react";

import { ChannelDialog } from "./channel-dialog";
import { NewConversationDialog } from "./new-conversation-dialog";

export function MessagesEmptyState({ orgSlug }: { orgSlug: string }) {
	const [dialogOpen, setDialogOpen] = useState(false);
	const [channelOpen, setChannelOpen] = useState(false);

	return (
		<div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
			<MessageSquareIcon aria-hidden className="size-8 text-app-text-muted" />
			<p className="text-sm font-medium text-app-text">Select a conversation</p>
			<p className="max-w-xs text-xs text-app-text-muted">
				Your chats and channels are in the sidebar. Pick one, or start something
				new.
			</p>
			<div className="flex flex-wrap items-center justify-center gap-2">
				<Button size="sm" onPress={() => setDialogOpen(true)}>
					<MessageSquarePlusIcon aria-hidden />
					New message
				</Button>
				<Button
					size="sm"
					variant="outline"
					onPress={() => setChannelOpen(true)}
				>
					<HashIcon aria-hidden />
					Create a channel
				</Button>
			</div>

			<NewConversationDialog
				orgSlug={orgSlug}
				isOpen={dialogOpen}
				onOpenChange={setDialogOpen}
			/>
			<ChannelDialog
				orgSlug={orgSlug}
				isOpen={channelOpen}
				onOpenChange={setChannelOpen}
			/>
		</div>
	);
}
