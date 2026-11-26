"use client";

/**
 * One message in a conversation.
 *
 * Why the layout is flat: this surface follows the chat shape people already
 * use every day. A message is a row, not a bubble. Consecutive messages from the
 * same author collapse into one block with a single avatar and name, so a busy
 * conversation reads as a transcript instead of a stack of cards.
 *
 * The whole row is the hover target. Actions float over the top right corner,
 * which keeps them close to the message without pushing the text around. On a
 * touch screen, where there is no hover, the actions stay visible.
 *
 * A deleted message keeps its row and its author, so the conversation keeps its
 * shape. The body is blanked, exactly like a deleted comment.
 *
 * Used by: message-list.tsx, thread-panel.tsx and thread-view.tsx.
 */

import { Avatar, AvatarFallback, AvatarImage } from "@org/ui/components/avatar";
import { Button } from "@org/ui/components/button";
import { cn } from "cn";
import {
	CheckIcon,
	ExternalLinkIcon,
	MessageSquareIcon,
	PencilIcon,
	ReplyIcon,
	Trash2Icon,
	XIcon,
} from "lucide-react";
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
import { formatClockTime, formatDateTime } from "#/lib/date";
import type { ConversationMessage } from "./api";
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
function PendingRow({
	pending,
	onRetry,
}: {
	pending: PendingMessage;
	onRetry: () => void;
}) {
	return (
		<div className="flex gap-3 px-4 py-1">
			<div className="w-9 shrink-0" />

			<div className="flex min-w-0 flex-1 flex-col items-start gap-1 pb-1">
				<span className="text-[0.65rem] text-app-text-muted">
					{pending.failed ? "Not sent" : "Sending..."}
				</span>
				<div
					className={cn(
						"max-w-full border px-3 py-2",
						pending.failed
							? "border-danger bg-danger-bg"
							: "border-app-border bg-app-panel-subtle opacity-70",
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
	elementId,
	onRetry,
	replyCount = 0,
	unreadReplyCount = 0,
	hideReply = false,
	grouped = false,
	highlighted = false,
	repliesOpen = false,
	onReply,
	onOpenThread,
}: {
	/** Null only when `pending` is set. */
	message: ConversationMessage | null;
	/** Set instead of a stored message when the row is optimistic. */
	pending?: PendingMessage;
	viewerId: string;
	organizationId: string;
	organizationSlug: string;
	/** True when this is the last message the other person has read. */
	showSeen: boolean;
	/** Override the DOM id when the same message renders in two places. */
	elementId?: string;
	onRetry?: () => void;
	/** Replies on the root, shown as "N replies". */
	replyCount?: number;
	/** Replies this viewer has not read, shown as a dot. */
	unreadReplyCount?: number;
	/** Hide the reply actions, used by the root inside its own thread. */
	hideReply?: boolean;
	/** True when the previous row had the same author on the same day. */
	grouped?: boolean;
	/** True while a search jump is pointing at this row. */
	highlighted?: boolean;
	/** True while the thread panel is showing this root. */
	repliesOpen?: boolean;
	/** Open the thread panel and focus its composer. */
	onReply?: () => void;
	/** Open the dedicated thread view in a new browser tab. */
	onOpenThread?: () => void;
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
		return <PendingRow pending={pending} onRetry={onRetry ?? (() => {})} />;
	}

	if (!message) return null;

	const own = message.author?.id === viewerId;
	const authorName = own ? "You" : (message.author?.name ?? "Former member");
	// The avatar always shows the real person, never the "You" label.
	const avatarName = message.author?.name ?? authorName;
	const deleted = message.deletedAt !== null;
	const isRoot = message.parentId === null;
	/*
	 * A deleted root keeps its thread. Hiding the chip would strand every reply
	 * behind a row that is no longer clickable, so the chip stays and the panel
	 * opens read only.
	 */
	const hasThread = isRoot && replyCount > 0;

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
			id={elementId ?? `message-${message.id}`}
			className={cn(
				"group/message relative flex gap-3 px-4 py-0.5 transition-colors",
				"hover:bg-app-panel-subtle",
				highlighted && "bg-app-selected/40",
				highlighted && "outline outline-app-focus",
			)}
		>
			{/*
			 * The avatar gutter is always reserved so every row lines up. Only the
			 * first row of a group shows the picture. The rest reveal the clock
			 * time there on hover, which is how a grouped transcript stays readable
			 * without repeating a header.
			 */}
			<div className="flex w-9 shrink-0 justify-center pt-0.5">
				{grouped ? (
					<span className="hidden pt-1 text-[0.6rem] leading-none text-app-text-muted tabular-nums group-hover/message:block">
						{formatClockTime(message.createdAt)}
					</span>
				) : (
					<Avatar size="sm">
						{message.author?.image && (
							<AvatarImage src={message.author.image} alt="" />
						)}
						<AvatarFallback>{initials(avatarName)}</AvatarFallback>
					</Avatar>
				)}
			</div>

			<div className="flex min-w-0 flex-1 flex-col items-start pb-1">
				{!grouped && (
					<div className="flex flex-wrap items-baseline gap-2">
						<span className="text-sm font-semibold text-app-text">
							{authorName}
						</span>
						<time
							dateTime={message.createdAt}
							title={formatDateTime(message.createdAt)}
							className="text-[0.65rem] text-app-text-muted tabular-nums"
						>
							{formatClockTime(message.createdAt)}
						</time>
						{message.editedAt && !deleted && (
							<span className="text-[0.65rem] text-app-text-muted">edited</span>
						)}
					</div>
				)}

				{editing ? (
					<div className="mt-1 w-full min-w-72 border border-app-border bg-app-panel">
						<CommentEditor
							initialValue={message.body}
							editorId={`message-editor-${messageId}`}
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
					<div className="w-full min-w-0 text-sm leading-relaxed text-app-text">
						{deleted ? (
							<p className="text-app-text-muted italic">
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

				{/*
				 * The thread summary is a small card, not an inline panel. This is
				 * the entry point to the thread surface, and it carries the unread
				 * reply dot, so a reader can see there is a conversation to open
				 * without expanding the whole timeline.
				 */}
				{hasThread && !hideReply && (
					<button
						type="button"
						onClick={onReply}
						aria-expanded={repliesOpen}
						className={cn(
							"mt-1.5 flex max-w-full items-center gap-2 border px-2 py-1 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
							repliesOpen
								? "border-app-focus bg-app-selected"
								: "border-app-border bg-app-panel hover:border-app-border-strong hover:bg-app-panel-subtle",
						)}
					>
						<MessageSquareIcon
							aria-hidden
							className="size-3.5 shrink-0 text-app-text-muted"
						/>
						<span className="text-xs font-medium text-app-text">
							{replyCount} {replyCount === 1 ? "reply" : "replies"}
						</span>
						{unreadReplyCount > 0 && (
							<span
								role="img"
								aria-label={`${unreadReplyCount} unread ${
									unreadReplyCount === 1 ? "reply" : "replies"
								}`}
								className="inline-block size-1.5 shrink-0 rounded-full bg-app-attention"
							/>
						)}
						<span className="truncate text-xs text-app-text-muted">
							View thread
						</span>
					</button>
				)}

				{showSeen && own && !deleted && (
					<span className="mt-0.5 text-[0.65rem] text-app-text-muted">
						Seen
					</span>
				)}
			</div>

			{/*
			 * Actions float over the row and only take focus order when they are
			 * relevant. A fine pointer reveals them on hover; a touch device or a
			 * keyboard keeps them visible, so nothing is hover only.
			 */}
			{!editing && !deleted && (
				<div
					className={cn(
						"absolute -top-3 right-4 z-10 flex items-center gap-0.5 border border-app-border bg-app-panel px-0.5 shadow-sm",
						"pointer-fine:pointer-events-none pointer-fine:opacity-0",
						"pointer-fine:group-hover/message:pointer-events-auto pointer-fine:group-hover/message:opacity-100",
						"pointer-fine:group-focus-within/message:pointer-events-auto pointer-fine:group-focus-within/message:opacity-100",
						confirmDelete &&
							"pointer-fine:pointer-events-auto pointer-fine:opacity-100",
					)}
				>
					{isRoot && !hideReply && (
						<Button
							variant="ghost"
							size="icon-xs"
							aria-label="Reply in thread"
							onPress={onReply}
						>
							<ReplyIcon aria-hidden />
						</Button>
					)}

					{isRoot && !hideReply && (
						<Button
							variant="ghost"
							size="icon-xs"
							aria-label="Open thread in new tab"
							onPress={onOpenThread}
						>
							<ExternalLinkIcon aria-hidden />
						</Button>
					)}

					{own && (
						<>
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
						</>
					)}
				</div>
			)}
		</div>
	);
}
