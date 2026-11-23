"use client";

/**
 * The boundary between read and unread messages.
 *
 * Why a divider instead of tinting every unread row: a chat reader needs one
 * clear answer to "where did I stop", not a second visual language. Everything
 * after this line is new; everything before it has been seen.
 *
 * Used by: comment-thread.tsx.
 */

export function CommentUnreadDivider() {
	return (
		<div className="flex items-center gap-2 py-1">
			<span className="h-px flex-1 bg-app-attention" />
			<span className="bg-app-attention px-2 py-0.5 text-[0.6rem] font-semibold tracking-widest text-app-attention-text uppercase">
				New messages
			</span>
			<span className="h-px flex-1 bg-app-attention" />
		</div>
	);
}
