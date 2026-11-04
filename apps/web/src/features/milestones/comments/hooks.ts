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
	useQueryClient,
} from "@tanstack/react-query";

import { ApiRequestError } from "#/lib/api";
import type { MilestoneDetailResponse } from "../api";
import { milestoneDetailKey, milestonesKey } from "../hooks";
import {
	type Comment,
	type CommentPage,
	createComment,
	deleteComment,
	fetchComments,
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

/** Keep the tab badge in step with the server's total. */
function patchCommentCount(
	queryClient: ReturnType<typeof useQueryClient>,
	orgSlug: string,
	projectId: string,
	milestoneId: string,
	total: number,
): void {
	queryClient.setQueryData<MilestoneDetailResponse>(
		milestoneDetailKey(orgSlug, projectId, milestoneId),
		(current) =>
			current
				? {
						...current,
						milestone: { ...current.milestone, commentCount: total },
					}
				: current,
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

			patchCommentCount(
				queryClient,
				orgSlug,
				projectId,
				milestoneId,
				data.total,
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
			patchCommentCount(
				queryClient,
				orgSlug,
				projectId,
				milestoneId,
				data.total,
			);
		},
	});
}
