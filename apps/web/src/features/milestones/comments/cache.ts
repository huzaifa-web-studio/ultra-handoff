/**
 * Pure comment cache reducers.
 *
 * Why pure: the same reducers serve a mutation response and a realtime event,
 * and a realtime event can be delivered twice (the author's own echo, or a
 * replay after a reconnect). Keeping them free of React and the query client
 * is what makes the idempotency rule easy to state and easy to test:
 * an id that already exists is replaced, never appended again.
 *
 * Used by: comments/hooks.ts.
 */

import type { InfiniteData } from "@tanstack/react-query";

import type { Comment, CommentPage } from "./api";

/** The shape react-query stores for the paged discussion. */
export type CommentPages = InfiniteData<CommentPage, string | null>;

/** Replace one comment wherever it lives in the paged list. */
export function replaceInPages(
	data: CommentPages,
	next: Comment,
): CommentPages {
	return {
		...data,
		pages: data.pages.map((page) => ({
			...page,
			threads: page.threads.map((thread) => {
				if (thread.comment.id === next.id) {
					return { ...thread, comment: next };
				}

				if (!thread.replies.some((reply) => reply.id === next.id)) {
					return thread;
				}

				return {
					...thread,
					replies: thread.replies.map((reply) =>
						reply.id === next.id ? next : reply,
					),
				};
			}),
		})),
	};
}

/**
 * Add a new comment to the page that owns its thread.
 *
 * Idempotent on purpose: if the id is already cached, the row is replaced. A
 * blind append would duplicate the author's own comment, because the HTTP
 * response and the realtime echo both arrive.
 */
export function appendToPages(data: CommentPages, next: Comment): CommentPages {
	// A reply belongs to its root, wherever that root is paged.
	if (next.parentId) {
		return {
			...data,
			pages: data.pages.map((page) => ({
				...page,
				threads: page.threads.map((thread) => {
					if (thread.comment.id !== next.parentId) return thread;

					const exists = thread.replies.some((reply) => reply.id === next.id);

					return {
						...thread,
						replies: exists
							? thread.replies.map((reply) =>
									reply.id === next.id ? next : reply,
								)
							: [...thread.replies, next],
					};
				}),
			})),
		};
	}

	// A root that is already cached is an echo or a replay, not a new row.
	const exists = data.pages.some((page) =>
		page.threads.some((thread) => thread.comment.id === next.id),
	);

	if (exists) return replaceInPages(data, next);

	// A root goes at the end of the newest page, which is page zero and reads
	// oldest first inside itself.
	const [newest, ...older] = data.pages;

	if (!newest) return data;

	return {
		...data,
		pages: [
			{
				...newest,
				threads: [
					...newest.threads,
					{
						comment: next,
						replies: [],
						unread: { count: 0, firstUnreadCommentId: null },
					},
				],
			},
			...older,
		],
	};
}

/** Write the new visible count into every loaded page. */
export function withTotal(data: CommentPages, total: number): CommentPages {
	return {
		...data,
		pages: data.pages.map((page) => ({ ...page, total })),
	};
}

/** Write the milestone unread total into every loaded page. */
export function withUnreadTotal(
	data: CommentPages,
	unreadTotal: number,
): CommentPages {
	return {
		...data,
		pages: data.pages.map((page) => ({ ...page, unreadTotal })),
	};
}

/** True when a comment id is already in the cache, used to skip echo bumps. */
export function hasComment(data: CommentPages, commentId: string): boolean {
	return data.pages.some((page) =>
		page.threads.some(
			(thread) =>
				thread.comment.id === commentId ||
				thread.replies.some((reply) => reply.id === commentId),
		),
	);
}

/**
 * Add one new message to its thread's unread count.
 *
 * The server is still the authority; this only keeps the divider correct
 * between a realtime arrival and the next refetch. It is skipped for the
 * viewer's own message, an activity row and a deleted row.
 */
export function withUnreadComment(
	data: CommentPages,
	comment: Comment,
	viewerId: string,
): CommentPages {
	if (comment.kind !== "comment") return data;
	if (comment.deletedAt !== null) return data;
	if (comment.author?.id === viewerId) return data;

	const rootId = comment.parentId ?? comment.id;

	return {
		...data,
		pages: data.pages.map((page) => ({
			...page,
			threads: page.threads.map((thread) => {
				if (thread.comment.id !== rootId) return thread;

				return {
					...thread,
					unread: {
						count: thread.unread.count + 1,
						firstUnreadCommentId:
							thread.unread.firstUnreadCommentId ?? comment.id,
					},
				};
			}),
		})),
	};
}
