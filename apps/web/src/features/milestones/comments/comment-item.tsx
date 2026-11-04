"use client";

/**
 * One comment, with its metadata, body and author actions.
 *
 * Why one component for roots and replies: they differ only in density and in
 * whether Reply is offered. One file keeps the edit and delete behaviour
 * identical for both, which is what stops a reply from quietly gaining an
 * action its root does not have.
 *
 * Actions sit at the right edge of the author row, icon only, each with a
 * tooltip for pointer users and an aria-label for assistive technology. Keeping
 * them in the header means the message body stays a clean reading column.
 *
 * Used by: comment-thread.tsx.
 */

import { Button } from "@org/ui/components/button";
import {
	Message,
	MessageAvatar,
	MessageContent,
} from "@org/ui/components/message";
import { Tooltip, TooltipTrigger } from "@org/ui/components/tooltip";
import { cn } from "cn";
import {
	PencilIcon,
	ReplyIcon,
	SquareArrowOutUpRightIcon,
	Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { UserAvatar } from "#/components/user-avatar";
import { formatCommentTime, formatDateTime } from "#/lib/date";
import type { Comment } from "./api";
import {
	COMMENT_TEXT_MAX,
	commentHasContent,
	commentText,
	isCommentChanged,
} from "./comment-utils";
import { CommentBody, CommentEditor } from "./editor/comment-editor";
import { CommentToolbar } from "./editor/comment-toolbar";
import { useToggleChecklist, useUpdateComment } from "./hooks";

/**
 * One icon action in the comment header.
 *
 * Icon only, with a tooltip for the label and an aria-label for assistive
 * technology. The actions sit at the right edge of the name row, which keeps
 * them out of the reading flow of the message body.
 */
function CommentAction({
	label,
	onPress,
	children,
}: {
	label: string;
	onPress: () => void;
	children: React.ReactNode;
}) {
	return (
		<TooltipTrigger>
			<Button
				variant="ghost"
				size="icon-xs"
				aria-label={label}
				onPress={onPress}
				className="text-app-text-muted hover:text-app-text"
			>
				{children}
			</Button>
			<Tooltip>{label}</Tooltip>
		</TooltipTrigger>
	);
}

export function CommentItem({
	orgSlug,
	organizationId,
	projectId,
	milestoneId,
	viewerId,
	comment,
	isReply = false,
	canComment,
	onReply,
	onOpenTab,
	onRequestDelete,
}: {
	orgSlug: string;
	organizationId: string;
	projectId: string;
	milestoneId: string;
	/** The signed in user, so your own comments can be marked as yours. */
	viewerId: string;
	comment: Comment;
	isReply?: boolean;
	canComment: boolean;
	/** Present on a root only. Replies are one level deep. */
	onReply?: () => void;
	/** Present on a root in the main comments tab, not inside a focused tab. */
	onOpenTab?: () => void;
	onRequestDelete: (comment: Comment) => void;
}) {
	const update = useUpdateComment(orgSlug, projectId, milestoneId);
	const toggleChecklist = useToggleChecklist(orgSlug, projectId, milestoneId);

	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState<unknown[]>(comment.body);
	const [attachmentUploading, setAttachmentUploading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const authorName = comment.author?.name ?? "Former member";
	const isOwn = Boolean(viewerId) && comment.author?.id === viewerId;
	const deleted = comment.deletedAt !== null;
	const edited = comment.editedAt !== null;

	const text = commentText(draft);
	const tooLong = text.length > COMMENT_TEXT_MAX;
	const changed = isCommentChanged(draft, comment.body);
	// The same rule as the composer: an attachment is content.
	const canSave =
		commentHasContent(draft) &&
		!tooLong &&
		changed &&
		!update.isPending &&
		!attachmentUploading;

	function startEdit() {
		setDraft(comment.body);
		setError(null);
		setEditing(true);
	}

	function cancelEdit() {
		if (update.isPending) return;

		setDraft(comment.body);
		setError(null);
		setEditing(false);
	}

	async function saveEdit() {
		if (!canSave) return;

		setError(null);

		try {
			await update.mutateAsync({ commentId: comment.id, body: draft });
			setEditing(false);
		} catch (saveError) {
			setError(
				saveError instanceof Error
					? saveError.message
					: "Could not save the comment.",
			);
		}
	}

	/**
	 * Tick a checklist item without entering edit mode.
	 *
	 * The endpoint is open to anyone who can comment, so the author and every
	 * other participant use the same path. A failed toggle is a toast because
	 * the checkbox itself reverts to the stored value.
	 */
	async function handleToggleChecklist(itemId: string, checked: boolean) {
		try {
			await toggleChecklist.mutateAsync({
				commentId: comment.id,
				itemId,
				checked,
			});
		} catch (toggleError) {
			toast.error(
				toggleError instanceof Error
					? toggleError.message
					: "Could not update the checklist.",
			);
			throw toggleError;
		}
	}

	return (
		/*
		 * The left accent is the quick visual answer to "is this mine". It is
		 * paired with the You chip in the header so the signal is never colour
		 * only.
		 */
		<div className={cn(isOwn && "border-l-2 border-app-focus pl-3")}>
			<Message align="start" className={cn(isReply ? "gap-2" : "gap-3")}>
				<MessageAvatar className="self-start">
					<UserAvatar
						src={comment.author?.image}
						name={authorName}
						size={isReply ? "sm" : "default"}
					/>
				</MessageAvatar>

				<MessageContent className="min-w-0 gap-1">
					<div className="flex items-center gap-2">
						<div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
							<span
								className={cn(
									"text-sm font-medium text-app-text",
									isReply && "text-xs",
								)}
							>
								{authorName}
							</span>

							{/*
							 * A word, not only a colour. The gold accent bar is the fast
							 * visual signal; this chip is what makes it accessible and
							 * unambiguous without relying on colour alone.
							 */}
							{isOwn && (
								<span className="border border-app-focus px-1 py-px text-[0.6rem] font-semibold tracking-wider text-app-focus uppercase">
									You
								</span>
							)}

							{/*
							 * Recent comments read as elapsed time, which is what a reader
							 * scanning a live thread actually wants. Anything older than a
							 * day falls back to the absolute day month year and time. The
							 * full timestamp is always one hover away.
							 */}
							<time
								dateTime={comment.createdAt}
								title={formatDateTime(comment.createdAt)}
								className="text-xs text-app-text-muted"
							>
								{formatCommentTime(comment.createdAt)}
							</time>

							{edited && !deleted && (
								<span
									className="text-xs text-app-text-muted"
									title={
										comment.editedAt
											? `Edited ${formatDateTime(comment.editedAt)}`
											: undefined
									}
								>
									Edited
								</span>
							)}
						</div>

						{!deleted && !editing && (
							<div className="ml-auto flex shrink-0 items-center gap-0.5">
								{onReply && canComment && (
									<CommentAction label="Reply" onPress={onReply}>
										<ReplyIcon aria-hidden />
									</CommentAction>
								)}

								{onOpenTab && (
									<CommentAction label="Open as tab" onPress={onOpenTab}>
										<SquareArrowOutUpRightIcon aria-hidden />
									</CommentAction>
								)}

								{comment.canEdit && (
									<CommentAction label="Edit" onPress={startEdit}>
										<PencilIcon aria-hidden />
									</CommentAction>
								)}

								{comment.canDelete && (
									<CommentAction
										label="Delete"
										onPress={() => onRequestDelete(comment)}
									>
										<Trash2Icon aria-hidden />
									</CommentAction>
								)}
							</div>
						)}
					</div>

					{deleted ? (
						<p className="text-sm text-app-text-muted italic">
							This comment was deleted.
						</p>
					) : editing ? (
						<div className="flex flex-col gap-1.5">
							<div className="border border-app-border bg-app-panel transition-colors focus-within:border-app-focus">
								<CommentEditor
									initialValue={comment.body}
									onChange={setDraft}
									onSubmit={() => void saveEdit()}
									onCancel={cancelEdit}
									readOnly={update.isPending}
									organizationSlug={orgSlug}
									ariaLabel={`Edit comment by ${authorName}`}
									placeholder="Edit your comment..."
									minHeightClass="min-h-16"
									footer={
										<div className="flex flex-wrap items-center justify-between gap-2 border-t border-app-border px-1.5 py-1">
											<CommentToolbar
												organizationId={organizationId}
												organizationSlug={orgSlug}
												onUploadingChange={setAttachmentUploading}
											/>

											<div className="flex items-center gap-2">
												{tooLong && (
													<span className="text-[0.65rem] text-danger tabular-nums">
														{text.length}/{COMMENT_TEXT_MAX}
													</span>
												)}

												<Button
													variant="ghost"
													size="sm"
													isDisabled={update.isPending}
													onPress={cancelEdit}
												>
													Cancel
												</Button>
												<Button
													size="sm"
													loading={update.isPending}
													isDisabled={!canSave}
													onPress={() => void saveEdit()}
												>
													Save
												</Button>
											</div>
										</div>
									}
								/>
							</div>

							{error && (
								<p role="alert" className="text-xs text-danger">
									{error}
								</p>
							)}
						</div>
					) : (
						<CommentBody
							// Remount on every body change, including a checklist
							// toggle, otherwise the static editor would keep the value
							// it mounted with and the checkbox would never move.
							key={`${comment.id}-${comment.updatedAt}`}
							value={comment.body}
							ariaLabel={`Comment by ${authorName}`}
							organizationSlug={orgSlug}
							canToggleChecklist={canComment}
							checklistPending={toggleChecklist.isPending}
							onToggleChecklist={handleToggleChecklist}
						/>
					)}
				</MessageContent>
			</Message>
		</div>
	);
}
