"use client";

/**
 * The bottom docked comment composer.
 *
 * Why docked at the bottom: a discussion reads top to bottom, so the place to
 * write belongs at the bottom edge, where the reader already is. The formatting
 * controls and the Post button sit under the text in the same card, which is
 * the shape the product asked for: an editor action at the bottom, not a plus
 * icon in the gutter.
 *
 * Behaviour:
 *   - the draft stays local, so typing never re-renders the thread
 *   - a failed post keeps the draft and offers a retry, so a long comment is
 *     never lost to a network blip
 *   - the editor is remounted after a successful post, which is the only
 *     reliable way to clear Slate's undo history
 *   - the same composer handles a new comment and a reply. When replying, a
 *     banner names the target and the parent id is sent with the post, so one
 *     composer and one draft cover the whole discussion.
 *
 * Used by: comment-tab.tsx.
 */

import { Button } from "@org/ui/components/button";
import { cn } from "cn";
import { ReplyIcon, SendIcon, XIcon } from "lucide-react";
import { useState } from "react";
import {
	COMMENT_TEXT_MAX,
	commentHasContent,
	commentText,
} from "./comment-utils";
import { CommentEditor } from "./editor/comment-editor";
import { CommentToolbar } from "./editor/comment-toolbar";
import { useCreateComment } from "./hooks";

export function CommentComposer({
	orgSlug,
	organizationId,
	projectId,
	milestoneId,
	parentId = null,
	replyingToName,
	autoFocus = false,
	focusToken = 0,
	onDone,
	onPosted,
}: {
	orgSlug: string;
	organizationId: string;
	projectId: string;
	milestoneId: string;
	/** Set for a reply. A reply is one level deep, enforced by the API too. */
	parentId?: string | null;
	replyingToName?: string;
	autoFocus?: boolean;
	/** Bumped when Reply is pressed, so the editor focuses even if mounted. */
	focusToken?: number;
	/** Clears the reply target and hides the reply banner. */
	onDone?: () => void;
	/** Lets the tab scroll to the new comment and announce it. */
	onPosted?: () => void;
}) {
	const create = useCreateComment(orgSlug, projectId, milestoneId);

	const [draft, setDraft] = useState<unknown[]>([]);
	// Bumped after a successful post to remount the editor with an empty value.
	const [editorVersion, setEditorVersion] = useState(0);
	// The main composer stays open after posting, so it keeps the caret ready
	// for the next message. A reply closes, so it never sets this.
	const [focusAfterPost, setFocusAfterPost] = useState(false);
	const [attachmentUploading, setAttachmentUploading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const text = commentText(draft);
	const length = text.length;
	const tooLong = length > COMMENT_TEXT_MAX;
	// An image, a file or a bookmark is enough on its own. Text is only one of
	// the things that make a comment worth posting.
	const hasContent = commentHasContent(draft);
	// Do not send while an attachment is still uploading, otherwise the message
	// would go out without the file the writer just picked.
	const canPost =
		hasContent && !tooLong && !create.isPending && !attachmentUploading;

	async function submit() {
		if (!canPost) return;

		setError(null);

		try {
			await create.mutateAsync({ body: draft, parentId });
			setDraft([]);
			setEditorVersion((current) => current + 1);
			setFocusAfterPost(true);
			onPosted?.();
			onDone?.();
		} catch (postError) {
			setError(
				postError instanceof Error
					? postError.message
					: "Could not post the comment.",
			);
		}
	}

	return (
		<div className={cn("flex flex-col gap-1.5")}>
			<div className="border border-app-border bg-app-panel transition-colors focus-within:border-app-focus">
				{/*
				 * The reply target lives in the main composer, not in an inline
				 * box under the thread. The banner is the visible answer to "who
				 * am I writing to" and the X clears it.
				 */}
				{parentId && (
					<div className="flex items-center gap-2 border-b border-app-border bg-app-panel-subtle px-3 py-1.5 text-xs">
						<ReplyIcon
							className="size-3.5 shrink-0 text-app-text-muted"
							aria-hidden
						/>
						<span className="min-w-0 flex-1 truncate text-app-text-muted">
							Replying to{" "}
							<span className="font-medium text-app-text">
								{replyingToName ?? "this comment"}
							</span>
						</span>
						{onDone && (
							<Button
								variant="ghost"
								size="icon-xs"
								aria-label="Cancel reply"
								onPress={onDone}
							>
								<XIcon aria-hidden />
							</Button>
						)}
					</div>
				)}

				<CommentEditor
					key={editorVersion}
					initialValue={[]}
					onChange={setDraft}
					onSubmit={() => void submit()}
					onCancel={onDone}
					autoFocus={autoFocus || focusAfterPost}
					focusToken={focusToken}
					readOnly={create.isPending}
					organizationSlug={orgSlug}
					ariaLabel={
						parentId
							? `Reply to ${replyingToName ?? "this comment"}`
							: "Write a comment"
					}
					placeholder={
						parentId
							? `Reply to ${replyingToName ?? "this comment"}...`
							: "Write a comment..."
					}
					footer={
						<div className="flex flex-wrap items-center justify-between gap-2 border-t border-app-border px-1.5 py-1">
							<CommentToolbar
								organizationId={organizationId}
								organizationSlug={orgSlug}
								onUploadingChange={setAttachmentUploading}
							/>

							<div className="flex items-center gap-2">
								{/* The counter only appears when it can be useful. */}
								{length > COMMENT_TEXT_MAX - 500 && (
									<span
										aria-live="polite"
										className={cn(
											"text-[0.65rem] tabular-nums",
											tooLong ? "text-danger" : "text-app-text-muted",
										)}
									>
										{length}/{COMMENT_TEXT_MAX}
									</span>
								)}

								{onDone && (
									<Button
										variant="ghost"
										size="sm"
										isDisabled={create.isPending}
										onPress={onDone}
									>
										Cancel
									</Button>
								)}

								<Button
									size="sm"
									loading={create.isPending}
									isDisabled={!canPost}
									onPress={() => void submit()}
								>
									<SendIcon aria-hidden />
									Post
								</Button>
							</div>
						</div>
					}
				/>
			</div>

			{error && (
				<div
					role="alert"
					className="flex flex-wrap items-center gap-2 border border-danger bg-danger-bg p-2 text-xs text-danger"
				>
					<span className="flex-1">{error}</span>
					<Button
						size="xs"
						variant="surface"
						loading={create.isPending}
						onPress={() => void submit()}
					>
						Try again
					</Button>
				</div>
			)}
		</div>
	);
}
