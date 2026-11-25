"use client";

/**
 * One message in a thread.
 *
 * Why own messages sit on the right: it is the layout people already know from
 * a chat, and it makes the author obvious without reading a name on every row.
 *
 * A deleted message keeps its row and its author, so the conversation keeps its
 * shape. The body is blanked, exactly like a deleted comment.
 *
 * Used by: message-list.tsx.
 */

import { Avatar, AvatarFallback, AvatarImage } from "@org/ui/components/avatar";
import { Button } from "@org/ui/components/button";
import { cn } from "cn";
import { CheckIcon, PencilIcon, Trash2Icon, XIcon } from "lucide-react";
import { useState } from "react";
import {
	commentHasContent,
	commentText,
} from "#/features/milestones/comments/comment-utils";
import {
	CommentBody,
	CommentEditor,
} from "#/features/milestones/comments/editor/comment-editor";
import { CommentToolbar } from "#/features/milestones/comments/editor/comment-toolbar";
import type { Message } from "./api";
import { useDeleteMessage, useEditMessage } from "./hooks";

/** Initials for an avatar fallback. */
function initials(name: string): string {
	const parts = name.trim().split(/\s+/).slice(0, 2);

	return parts.map((part) => part.charAt(0).toUpperCase()).join("") || "?";
}

/** A pending message that has not reached the server yet. */
export type PendingMessage = {
	nonce: string;
	body: unknown[];
	failed: boolean;
};

/** The optimistic row shown while a send is in flight. */
function PendingBubble({
	pending,
	onRetry,
}: {
	pending: PendingMessage;
	onRetry: () => void;
}) {
	return (
		<div className="flex flex-row-reverse gap-2">
			<div className="flex max-w-[85%] flex-col items-end gap-1">
				<span className="text-xs text-app-text-muted">
					{pending.failed ? "Not sent" : "Sending..."}
				</span>
				<div
					className={cn(
						"border px-3 py-2",
						pending.failed
							? "border-danger bg-danger-bg"
							: "border-app-border bg-app-selected opacity-70",
					)}
				>
					<p className="text-sm break-words whitespace-pre-wrap text-app-text">
						{commentText(pending.body)}
					</p>
				</div>
				{pending.failed && (
					<Button size="xs" variant="surface" onPress={onRetry}>
						Try again
					</Button>
				)}
			</div>
		</div>
	);
}

export function MessageItem({
	message,
	pending,
	viewerId,
	organizationId,
	organizationSlug,
	showSeen,
	onRetry,
}: {
	/** Null only when `pending` is set. */
	message: Message | null;
	/** Set instead of a stored message when the row is optimistic. */
	pending?: PendingMessage;
	viewerId: string;
	organizationId: string;
	organizationSlug: string;
	/** True when this is the last message the other person has read. */
	showSeen: boolean;
	onRetry?: () => void;
}) {
	/*
	 * Hooks run before the early returns below, because a component must call
	 * the same hooks on every render. A pending row passes an empty id, and the
	 * mutations are never invoked from that branch.
	 */
	const conversationId = message?.conversationId ?? "";
	const messageId = message?.id ?? "";

	const edit = useEditMessage(organizationSlug, conversationId);
	const remove = useDeleteMessage(organizationSlug, conversationId);
	const [editing, setEditing] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [draft, setDraft] = useState<unknown[]>(message?.body ?? []);
	const [error, setError] = useState<string | null>(null);

	if (pending) {
		return <PendingBubble pending={pending} onRetry={onRetry ?? (() => {})} />;
	}

	if (!message) return null;

	const own = message.author?.id === viewerId;
	const authorName = own ? "You" : (message.author?.name ?? "Former member");
	const deleted = message.deletedAt !== null;

	async function save() {
		if (!commentHasContent(draft)) return;

		setError(null);

		try {
			await edit.mutateAsync({ messageId, body: draft });
			setEditing(false);
		} catch (saveError) {
			setError(
				saveError instanceof Error
					? saveError.message
					: "Could not save the message.",
			);
		}
	}

	async function removeMessage() {
		setError(null);

		try {
			await remove.mutateAsync(messageId);
			setConfirmDelete(false);
		} catch (deleteError) {
			setError(
				deleteError instanceof Error
					? deleteError.message
					: "Could not delete the message.",
			);
		}
	}

	return (
		<div
			id={`message-${message.id}`}
			className={cn("flex gap-2", own ? "flex-row-reverse" : "flex-row")}
		>
			<Avatar size="sm">
				{message.author?.image && (
					<AvatarImage src={message.author.image} alt="" />
				)}
				<AvatarFallback>{initials(authorName)}</AvatarFallback>
			</Avatar>

			<div
				className={cn(
					"flex min-w-0 max-w-[85%] flex-col gap-1",
					own ? "items-end" : "items-start",
				)}
			>
				<div className="flex items-baseline gap-2">
					<span className="text-xs font-medium text-app-text">
						{authorName}
					</span>
					{message.editedAt && !deleted && (
						<span className="text-[0.65rem] text-app-text-muted">edited</span>
					)}
				</div>

				{editing ? (
					<div className="w-full min-w-72 border border-app-border bg-app-panel">
						<CommentEditor
							initialValue={message.body}
							onChange={setDraft}
							onSubmit={() => void save()}
							onCancel={() => setEditing(false)}
							readOnly={edit.isPending}
							minHeightClass="min-h-12"
							organizationId={organizationId}
							organizationSlug={organizationSlug}
							mentionsEnabled={false}
							ariaLabel="Edit message"
							placeholder="Edit your message..."
							footer={
								<div className="flex flex-wrap items-center justify-between gap-2 border-t border-app-border px-1.5 py-1">
									<CommentToolbar
										organizationId={organizationId}
										organizationSlug={organizationSlug}
										mentionsEnabled={false}
									/>
									<div className="flex items-center gap-2">
										<Button
											variant="ghost"
											size="sm"
											onPress={() => setEditing(false)}
										>
											<XIcon aria-hidden />
											Cancel
										</Button>
										<Button
											size="sm"
											loading={edit.isPending}
											onPress={() => void save()}
										>
											<CheckIcon aria-hidden />
											Save
										</Button>
									</div>
								</div>
							}
						/>
					</div>
				) : (
					<div
						className={cn(
							"border px-3 py-2",
							own
								? "border-app-border bg-app-selected"
								: "border-app-border bg-app-panel-subtle",
							deleted && "border-dashed bg-transparent",
						)}
					>
						{deleted ? (
							<p className="text-sm text-app-text-muted italic">
								This message was deleted.
							</p>
						) : (
							<CommentBody
								value={message.body}
								ariaLabel={`Message from ${authorName}`}
								organizationSlug={organizationSlug}
								canToggleChecklist={false}
								checklistPending={false}
								onToggleChecklist={async () => undefined}
							/>
						)}
					</div>
				)}

				{error && (
					<p role="alert" className="text-xs text-danger">
						{error}
					</p>
				)}

				<div className="flex items-center gap-2">
					{showSeen && own && !deleted && (
						<span className="text-[0.65rem] text-app-text-muted">Seen</span>
					)}

					{own && !deleted && !editing && (
						<span className="flex items-center gap-0.5">
							<Button
								variant="ghost"
								size="icon-xs"
								aria-label="Edit message"
								onPress={() => {
									setDraft(message.body);
									setEditing(true);
								}}
							>
								<PencilIcon aria-hidden />
							</Button>

							{confirmDelete ? (
								<>
									<Button
										variant="destructive"
										size="icon-xs"
										aria-label="Confirm delete"
										loading={remove.isPending}
										onPress={() => void removeMessage()}
									>
										<CheckIcon aria-hidden />
									</Button>
									<Button
										variant="ghost"
										size="icon-xs"
										aria-label="Cancel delete"
										onPress={() => setConfirmDelete(false)}
									>
										<XIcon aria-hidden />
									</Button>
								</>
							) : (
								<Button
									variant="ghost"
									size="icon-xs"
									aria-label="Delete message"
									onPress={() => setConfirmDelete(true)}
								>
									<Trash2Icon aria-hidden />
								</Button>
							)}
						</span>
					)}
				</div>
			</div>
		</div>
	);
}
