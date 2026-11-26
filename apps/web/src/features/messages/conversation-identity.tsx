"use client";

/**
 * The identity strip at the top of a conversation.
 *
 * Why extracted: channels and direct messages share a header shape, but a
 * channel shows a hash and a direct chat shows the other person's avatar. The
 * view keeps the search and the settings action, and this component owns the
 * one visual difference.
 *
 * Used by: features/messages/conversation-view.tsx.
 */

import { Avatar, AvatarFallback, AvatarImage } from "@org/ui/components/avatar";
import { HashIcon } from "lucide-react";

/** Initials for an avatar fallback. */
function initials(name: string): string {
	const parts = name.trim().split(/\s+/).slice(0, 2);

	return parts.map((part) => part.charAt(0).toUpperCase()).join("") || "?";
}

export function ConversationIdentity({
	name,
	image,
	scope,
	status,
}: {
	name: string;
	image: string | null;
	scope: "direct" | "group" | "project";
	status: string;
}) {
	return (
		<>
			{scope === "group" ? (
				<span className="flex size-8 shrink-0 items-center justify-center border border-app-border text-app-text-muted">
					<HashIcon aria-hidden className="size-4" />
				</span>
			) : (
				<Avatar size="sm">
					{image && <AvatarImage src={image} alt="" />}
					<AvatarFallback>{initials(name)}</AvatarFallback>
				</Avatar>
			)}

			<div className="flex min-w-0 flex-1 flex-col">
				<p className="truncate text-sm font-semibold text-app-text">
					{scope === "group" ? `# ${name}` : name}
				</p>
				<p className="truncate text-xs text-app-text-muted" aria-live="polite">
					{status}
				</p>
			</div>
		</>
	);
}
