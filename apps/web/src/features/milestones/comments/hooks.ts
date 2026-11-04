/**
 * Data and mutations for milestone comments.
 *
 * Why react-query: the tab badge, the thread list and the composer all read the
 * same discussion, and a post, edit or delete must update each of them without
 * a full refetch of the milestone feature.
 *
 * Cache strategy:
 *   - a new comment is appended to the page that owns its thread, so posting
 *     feels immediate and never reloads the whole discussion
 *   - an edit or delete replaces the row in place, which keeps scroll position
 *     and open reply boxes exactly where the user left them
 *   - the milestone detail cache is patched with the returned total, so the tab
 *     badge is honest without another request
 *
 * Used by: every component in features/milestones/comments.
 */

import {
	type InfiniteData,
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";

import { ApiRequestError } from "#/lib/api";
import { milestonesKey } from "../hooks";
import {
	type Comment,
	type CommentPage,
	type CommentThreadResponse,
	createComment,
	deleteComment,
	fetchComments,
	fetchCommentThread,
	toggleCommentChecklist,
	updateComment,
} from "./api";

/** Every comment query for one milestone. */
export function commentsKey(
	orgSlug: string,
	projectId: string,
	milestoneId: string,
) {
	return [
		...milestonesKey(orgSlug, projectId),
		"comments",
		milestoneId,
	] as const;
}

/** One paged discussion. */
function listKey(orgSlug: string, projectId: string, milestoneId: string) {
	return [...commentsKey(orgSlug, projectId, milestoneId), "list"] as const;
}

/** One complete thread, used by the focused comment tab. */
function threadKey(
	orgSlug: string,
	projectId: string,
	milestoneId: string,
	commentId: string,
) {
	return [
		...commentsKey(orgSlug, projectId, milestoneId),
		"thread",
		commentId,
	] as const;
}

/** The shape react-query stores for the infinite list. */
type CommentPages = InfiniteData<CommentPage, string | null>;

/**
 * A 403 or 404 is a permission or existence answer, not a transient failure.
 * Retrying only delays the access card, so those stop after the first answer.
 */
function retryCommentQuery(failureCount: number, error: unknown): boolean {
	if (
		error instanceof ApiRequestError &&
		(error.status === 403 || error.status === 404)
	) {
		return false;
	}

	return failureCount < 2;
}

/** Run a page level update only when something is cached. */
function updatePages(
	queryClient: ReturnType<typeof useQueryClient>,
	key: ReturnType<typeof listKey>,
	updater: (data: CommentPages) => CommentPages,
): void {
	queryClient.setQueryData<CommentPages>(key, (current) =>
		current ? updater(current) : current,
	);
}

/** Replace one comment wherever it lives. */
function replaceInPages(data: CommentPages, next: Comment): CommentPages {
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

/** Add a new comment to the page that owns its thread. */
function appendToPages(data: CommentPages, next: Comment): CommentPages {
	// A reply belongs to its root, wherever that root is paged.
	if (next.parentId) {
		return {
			...data,
			pages: data.pages.map((page) => ({
				...page,
				threads: page.threads.map((thread) =>
					thread.comment.id === next.parentId
						? { ...thread, replies: [...thread.replies, next] }
						: thread,
				),
			})),
		};
	}

	// A root goes at the end of the newest page, which is page zero and reads
	// oldest first inside itself.
	const [newest, ...older] = data.pages;

	if (!newest) return data;

	return {
		...data,
		pages: [
			{
				...newest,
				threads: [...newest.threads, { comment: next, replies: [] }],
			},
			...older,
		],
	};
}

/** Append a reply to a focused thread cache, when that thread is open. */
function appendReplyToThread(
	queryClient: ReturnType<typeof useQueryClient>,
	orgSlug: string,
	projectId: string,
	milestoneId: string,
	comment: Comment,
): void {
	if (!comment.parentId) return;

	queryClient.setQueryData<CommentThreadResponse>(
		threadKey(orgSlug, projectId, milestoneId, comment.parentId),
		(current) =>
			current
				? {
						thread: {
							...current.thread,
							replies: [...current.thread.replies, comment],
						},
					}
				: current,
	);
}

/** Replace a comment in a focused thread cache, when that thread is open. */
function replaceInThread(
	queryClient: ReturnType<typeof useQueryClient>,
	orgSlug: string,
	projectId: string,
	milestoneId: string,
	comment: Comment,
): void {
	const rootId = comment.parentId ?? comment.id;

	queryClient.setQueryData<CommentThreadResponse>(
		threadKey(orgSlug, projectId, milestoneId, rootId),
		(current) => {
			if (!current) return current;

			if (current.thread.comment.id === comment.id) {
				return { thread: { ...current.thread, comment } };
			}

			return {
				thread: {
					...current.thread,
					replies: current.thread.replies.map((reply) =>
						reply.id === comment.id ? comment : reply,
					),
				},
			};
		},
	);
}

/** One milestone's discussion, loaded page by page. */
export function useMilestoneComments(
	orgSlug: string,
	projectId: string,
	milestoneId: string | null,
	options?: { enabled?: boolean },
) {
	return useInfiniteQuery({
		queryKey: listKey(orgSlug, projectId, milestoneId ?? ""),
		queryFn: ({ pageParam }) =>
			fetchComments(orgSlug, projectId, milestoneId ?? "", pageParam),
		initialPageParam: null as string | null,
		getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
		enabled:
			Boolean(orgSlug) &&
			Boolean(projectId) &&
			Boolean(milestoneId) &&
			(options?.enabled ?? true),
		staleTime: 10_000,
		retry: retryCommentQuery,
	});
}

/** One complete thread, for the focused comment tab. */
export function useCommentThread(
	orgSlug: string,
	projectId: string,
	milestoneId: string,
	commentId: string,
	options?: { enabled?: boolean },
) {
	return useQuery({
		queryKey: threadKey(orgSlug, projectId, milestoneId, commentId),
		queryFn: () =>
			fetchCommentThread(orgSlug, projectId, milestoneId, commentId),
		enabled:
			Boolean(orgSlug) &&
			Boolean(projectId) &&
			Boolean(milestoneId) &&
			Boolean(commentId) &&
			(options?.enabled ?? true),
		staleTime: 10_000,
		retry: retryCommentQuery,
	});
}

/** Post a comment or a reply. */
export function useCreateComment(
	orgSlug: string,
	projectId: string,
	milestoneId: string,
) {
	const queryClient = useQueryClient();
	const key = listKey(orgSlug, projectId, milestoneId);

	return useMutation({
		mutationFn: (input: { body: unknown[]; parentId?: string | null }) =>
			createComment(orgSlug, projectId, milestoneId, input),
		onSuccess: (data) => {
			// The first page may still be in flight. Appending to it would race the
			// response that was requested before the insert, so the cache is marked
			// stale instead and the refetch picks the new comment up.
			if (queryClient.getQueryData<CommentPages>(key)) {
				updatePages(queryClient, key, (pages) =>
					appendToPages(pages, data.comment),
				);
			} else {
				void queryClient.invalidateQueries({ queryKey: key });
			}

			// A focused tab for the parent thread should see the reply too.
			appendReplyToThread(
				queryClient,
				orgSlug,
				projectId,
				milestoneId,
				data.comment,
			);
		},
	});
}

/** Change the body of your own comment. */
export function useUpdateComment(
	orgSlug: string,
	projectId: string,
	milestoneId: string,
) {
	const queryClient = useQueryClient();
	const key = listKey(orgSlug, projectId, milestoneId);

	return useMutation({
		mutationFn: ({ commentId, body }: { commentId: string; body: unknown[] }) =>
			updateComment(orgSlug, projectId, milestoneId, commentId, body),
		onSuccess: (data) => {
			updatePages(queryClient, key, (pages) =>
				replaceInPages(pages, data.comment),
			);
			replaceInThread(
				queryClient,
				orgSlug,
				projectId,
				milestoneId,
				data.comment,
			);
		},
	});
}

/**
 * Flip one checklist item.
 *
 * Allowed for anyone who can comment, including the client role. The response
 * replaces the comment in both the paged list and any focused thread, so the
 * checkbox and the rest of the body stay in step.
 */
export function useToggleChecklist(
	orgSlug: string,
	projectId: string,
	milestoneId: string,
) {
	const queryClient = useQueryClient();
	const key = listKey(orgSlug, projectId, milestoneId);

	return useMutation({
		mutationFn: ({
			commentId,
			itemId,
			checked,
		}: {
			commentId: string;
			itemId: string;
			checked: boolean;
		}) =>
			toggleCommentChecklist(orgSlug, projectId, milestoneId, commentId, {
				itemId,
				checked,
			}),
		onSuccess: (data) => {
			updatePages(queryClient, key, (pages) =>
				replaceInPages(pages, data.comment),
			);
			replaceInThread(
				queryClient,
				orgSlug,
				projectId,
				milestoneId,
				data.comment,
			);
		},
	});
}

/** Soft delete your own comment. */
export function useDeleteComment(
	orgSlug: string,
	projectId: string,
	milestoneId: string,
) {
	const queryClient = useQueryClient();
	const key = listKey(orgSlug, projectId, milestoneId);

	return useMutation({
		mutationFn: (commentId: string) =>
			deleteComment(orgSlug, projectId, milestoneId, commentId),
		onSuccess: (data) => {
			updatePages(queryClient, key, (pages) =>
				replaceInPages(pages, data.comment),
			);
			replaceInThread(
				queryClient,
				orgSlug,
				projectId,
				milestoneId,
				data.comment,
			);
		},
	});
}
