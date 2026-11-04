/**
 * Typed Eden calls for milestone comments.
 *
 * Why a feature API module: components never call `api` directly. The request
 * shape, the error conversion and the derived types live here, so a change to a
 * route only touches this file.
 *
 * Used by: features/milestones/comments/hooks.ts.
 */

import {
	ApiRequestError,
	api,
	readApiError,
	readApiErrorStatus,
} from "#/lib/api";

/** Read one page of the discussion, newest page first. */
export async function fetchComments(
	orgSlug: string,
	projectId: string,
	milestoneId: string,
	cursor: string | null,
) {
	const response = await api
		.orgs({ orgSlug })
		.projects({ projectId })
		.milestones({ milestoneId })
		.comments.get({ query: cursor ? { cursor } : {} });

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not load the comments."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not load the comments.", 0);
	}

	return response.data;
}

export type CommentPage = Awaited<ReturnType<typeof fetchComments>>;
export type CommentThread = CommentPage["threads"][number];
export type Comment = CommentThread["comment"];
export type CommentReply = CommentThread["replies"][number];

/** Read one complete thread, for the focused comment tab. */
export async function fetchCommentThread(
	orgSlug: string,
	projectId: string,
	milestoneId: string,
	commentId: string,
) {
	const response = await api
		.orgs({ orgSlug })
		.projects({ projectId })
		.milestones({ milestoneId })
		.comments({ commentId })
		.thread.get();

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not load the discussion."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not load the discussion.", 0);
	}

	return response.data;
}

export type CommentThreadResponse = Awaited<
	ReturnType<typeof fetchCommentThread>
>;

/** Post a comment, or a reply when `parentId` is set. */
export async function createComment(
	orgSlug: string,
	projectId: string,
	milestoneId: string,
	input: { body: unknown[]; parentId?: string | null },
): Promise<CommentWriteResponse> {
	const response = await api
		.orgs({ orgSlug })
		.projects({ projectId })
		.milestones({ milestoneId })
		.comments.post(input);

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not post the comment."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not post the comment.", 0);
	}

	return response.data;
}

export type CommentWriteResponse = {
	comment: Comment;
	total: number;
};

/** Change the body of your own comment. */
export async function updateComment(
	orgSlug: string,
	projectId: string,
	milestoneId: string,
	commentId: string,
	body: unknown[],
): Promise<CommentEditResponse> {
	const response = await api
		.orgs({ orgSlug })
		.projects({ projectId })
		.milestones({ milestoneId })
		.comments({ commentId })
		.patch({ body });

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not save the comment."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not save the comment.", 0);
	}

	return response.data;
}

export type CommentEditResponse = { comment: Comment };

/** Soft delete your own comment. */
export async function deleteComment(
	orgSlug: string,
	projectId: string,
	milestoneId: string,
	commentId: string,
): Promise<CommentWriteResponse> {
	const response = await api
		.orgs({ orgSlug })
		.projects({ projectId })
		.milestones({ milestoneId })
		.comments({ commentId })
		.delete();

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not delete the comment."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not delete the comment.", 0);
	}

	return response.data;
}
