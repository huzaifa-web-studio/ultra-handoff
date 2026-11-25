"use client";

/**
 * The new conversation picker.
 *
 * Why a dialog: starting a chat is a choice of person, and the workspace can
 * hold up to a hundred members. A searchable list is faster than a rail of
 * names, and it stays out of the way when the person already knows who they
 * want to reply to.
 *
 * The list comes from the workspace directory, which the product allows every
 * member to chat with every other member. A person who already has a
 * conversation opens that history; no second empty chat is created.
 *
 * Used by: conversation-list.tsx and the sidebar messages section.
 */

import { Avatar, AvatarFallback, AvatarImage } from "@org/ui/components/avatar";
import { Button } from "@org/ui/components/button";
import {
	Dialog,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@org/ui/components/dialog";
import { Input } from "@org/ui/components/input";
import { useNavigate } from "@tanstack/react-router";
import { Loader2Icon, SearchIcon } from "lucide-react";
import { useState } from "react";

import { useDebouncedValue } from "#/hooks/use-debounced-value";
import type { Contact } from "./api";
import { useContacts, useOpenConversation } from "./hooks";

/** Initials for an avatar fallback. */
function initials(name: string): string {
	const parts = name.trim().split(/\s+/).slice(0, 2);

	return parts.map((part) => part.charAt(0).toUpperCase()).join("") || "?";
}

export function NewConversationDialog({
	orgSlug,
	isOpen,
	onOpenChange,
}: {
	orgSlug: string;
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const navigate = useNavigate();
	const [search, setSearch] = useState("");
	const debounced = useDebouncedValue(search, 200);
	const contacts = useContacts(orgSlug, debounced, isOpen);
	const open = useOpenConversation(orgSlug);
	const [error, setError] = useState<string | null>(null);

	async function start(contact: Contact) {
		setError(null);

		// A conversation that already exists opens straight away.
		if (contact.conversationId) {
			onOpenChange(false);
			void navigate({
				to: "/$orgSlug/messages/$conversationId",
				params: { orgSlug, conversationId: contact.conversationId },
			});
			return;
		}

		try {
			const result = await open.mutateAsync(contact.userId);

			onOpenChange(false);
			void navigate({
				to: "/$orgSlug/messages/$conversationId",
				params: {
					orgSlug,
					conversationId: result.conversation.id,
				},
			});
		} catch (openError) {
			setError(
				openError instanceof Error
					? openError.message
					: "Could not open that conversation.",
			);
		}
	}

	return (
		<Dialog
			isOpen={isOpen}
			onOpenChange={(next) => {
				onOpenChange(next);

				if (!next) {
					setSearch("");
					setError(null);
				}
			}}
			className="sm:max-w-md"
		>
			<DialogHeader>
				<DialogTitle>New message</DialogTitle>
				<DialogDescription>
					Choose someone in this workspace to start a conversation.
				</DialogDescription>
			</DialogHeader>

			<div className="relative">
				<SearchIcon
					aria-hidden
					className="pointer-events-none absolute top-1/2 left-0 size-3.5 -translate-y-1/2 text-app-text-muted"
				/>
				<Input
					type="search"
					value={search}
					onChange={(event) => setSearch(event.target.value)}
					placeholder="Search name or email"
					aria-label="Search people"
					className="pl-6"
					autoFocus
				/>
			</div>

			{error && (
				<p role="alert" className="text-sm text-danger">
					{error}
				</p>
			)}

			<div className="min-h-0 flex-1 overflow-y-auto border-y border-app-border">
				{contacts.isPending ? (
					<p className="p-4 text-sm text-app-text-muted">Loading people...</p>
				) : contacts.isError ? (
					<p role="alert" className="p-4 text-sm text-danger">
						Could not load the people you can message.
					</p>
				) : (contacts.data?.contacts.length ?? 0) === 0 ? (
					<p className="p-4 text-sm text-app-text-muted">
						{debounced.trim()
							? "No one matches that search."
							: "There is no one else in this workspace yet."}
					</p>
				) : (
					<ul className="flex flex-col">
						{contacts.data?.contacts.map((contact) => (
							<li key={contact.userId}>
								<button
									type="button"
									onClick={() => void start(contact)}
									disabled={open.isPending}
									className="flex w-full items-center gap-3 px-2 py-2 text-left transition-colors hover:bg-app-panel-subtle focus-visible:bg-app-selected focus-visible:outline-none disabled:opacity-60"
								>
									<Avatar>
										{contact.image && (
											<AvatarImage src={contact.image} alt="" />
										)}
										<AvatarFallback>{initials(contact.name)}</AvatarFallback>
									</Avatar>
									<span className="min-w-0 flex-1">
										<span className="block truncate text-sm font-medium text-app-text">
											{contact.name}
										</span>
										<span className="block truncate text-xs text-app-text-muted">
											{contact.role}
										</span>
									</span>
									{open.isPending && open.variables === contact.userId && (
										<Loader2Icon
											aria-hidden
											className="size-4 animate-spin text-app-text-muted"
										/>
									)}
								</button>
							</li>
						))}
					</ul>
				)}
			</div>

			<div className="flex justify-end">
				<Button variant="ghost" onPress={() => onOpenChange(false)}>
					Close
				</Button>
			</div>
		</Dialog>
	);
}
