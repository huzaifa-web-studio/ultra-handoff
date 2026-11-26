"use client";

/**
 * The message composer.
 *
 * Why the same editor as comments: a message is a rich text body with images,
 * files, link cards, tables and checklists. Reusing the comment editor (and its
 * sanitizer on the server) keeps the two surfaces identical and avoids a second
 * renderer.
 *
 * Behaviour:
 *   - Enter sends, Shift+Enter inserts a line break, which is the chat contract
 *   - the draft is persisted per conversation, so a reload or a tab switch does
 *     not lose it
 *   - a failed send keeps the draft and offers a retry
 *   - typing frames are throttled by the caller, not per keystroke here
 *
 * Used by: conversation-view.tsx.
 */

import { Button } from "@org/ui/components/button";
import { cn } from "cn";
import { SendIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { authClient } from "#/features/auth/client";
import {
	COMMENT_TEXT_MAX,
	commentHasContent,
	commentText,
} from "#/features/milestones/comments/comment-utils";
import { CommentEditor } from "#/features/milestones/comments/editor/comment-editor";
import { CommentToolbar } from "#/features/milestones/comments/editor/comment-toolbar";
import { draftStorageKey, readDraft, writeDraft } from "./drafts";

export function MessageComposer({
	orgSlug,
	conversationId,
	onSend,
	onTyping,
	placeholder = "Write a message...",
	ariaLabel = "Write a message",
	draftId,
	autoFocus = false,
	focusToken = 0,
	minHeightClass = "min-h-16",
}: {
	orgSlug: string;
	conversationId: string;
	/** Resolves when the message is stored, rejects to keep the draft. */
	onSend: (body: unknown[]) => Promise<void>;
	/** Called on every change, for the throttled typing frame. */
	onTyping?: () => void;
	placeholder?: string;
	ariaLabel?: string;
	/** Draft scope. Defaults to the conversation, set per thread otherwise. */
	draftId?: string;
	/** Focus the editor when it first mounts. */
	autoFocus?: boolean;
	/** Bumped by the parent to focus an already mounted editor. */
	focusToken?: number;
	/** Editor height, so the panel composer can be shorter than the main one. */
	minHeightClass?: string;
}) {
	const { data: activeOrg } = authClient.useActiveOrganization();
	const organizationId = activeOrg?.id ?? "";
	const draftKey = draftStorageKey(orgSlug, draftId ?? conversationId);

	const [draft, setDraft] = useState<unknown[]>(() => readDraft(draftKey));
	// Bumped after a successful send to remount the editor with an empty value.
	const [editorVersion, setEditorVersion] = useState(0);
	const [sending, setSending] = useState(false);
	const [uploading, setUploading] = useState(false);
	const [focusAfterPost, setFocusAfterPost] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Persist the draft shortly after typing stops. A failure is silent: the
	// in-memory draft is still there for this mount.
	useEffect(() => {
		const timer = setTimeout(() => writeDraft(draftKey, draft), 400);

		return () => clearTimeout(timer);
	}, [draft, draftKey]);

	const text = commentText(draft);
	const tooLong = text.length > COMMENT_TEXT_MAX;
	const hasContent = commentHasContent(draft);
	const canSend = hasContent && !tooLong && !sending && !uploading;

	async function submit() {
		if (!canSend) return;

		setError(null);
		setSending(true);

		try {
			await onSend(draft);
			setDraft([]);
			writeDraft(draftKey, []);
			setEditorVersion((current) => current + 1);
			setFocusAfterPost(true);
		} catch (sendError) {
			setError(
				sendError instanceof Error
					? sendError.message
					: "Could not send the message.",
			);
		} finally {
			setSending(false);
		}
	}

	function handleChange(value: unknown[]) {
		setDraft(value);
		onTyping?.();
	}

	return (
		<div className="flex flex-col gap-1.5">
			<div className="border border-app-border bg-app-panel transition-colors focus-within:border-app-focus">
				<CommentEditor
					key={editorVersion}
					initialValue={draft}
					onChange={handleChange}
					onSubmit={() => void submit()}
					autoFocus={autoFocus || focusAfterPost}
					focusToken={focusToken}
					readOnly={sending}
					minHeightClass={minHeightClass}
					organizationId={organizationId}
					organizationSlug={orgSlug}
					mentionsEnabled={false}
					submitOnEnter
					onUploadingChange={setUploading}
					ariaLabel={ariaLabel}
					placeholder={placeholder}
					footer={
						<div className="flex flex-wrap items-center justify-between gap-2 border-t border-app-border px-1.5 py-1">
							<CommentToolbar
								organizationId={organizationId}
								organizationSlug={orgSlug}
								mentionsEnabled={false}
								onUploadingChange={setUploading}
							/>

							<div className="flex items-center gap-2">
								{text.length > COMMENT_TEXT_MAX - 500 && (
									<span
										aria-live="polite"
										className={cn(
											"text-[0.65rem] tabular-nums",
											tooLong ? "text-danger" : "text-app-text-muted",
										)}
									>
										{text.length}/{COMMENT_TEXT_MAX}
									</span>
								)}

								<Button
									size="sm"
									loading={sending}
									isDisabled={!canSend}
									aria-label="Send message"
									onPress={() => void submit()}
								>
									<SendIcon aria-hidden />
									Send
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
						loading={sending}
						onPress={() => void submit()}
					>
						Try again
					</Button>
				</div>
			)}
		</div>
	);
}
