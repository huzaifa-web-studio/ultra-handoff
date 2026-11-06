/**
 * Comment routes.
 *
 * Why a separate file from `milestones.ts`: comments are a generic resource
 * with their own paging, validation and permission rules, and their own future
 * surfaces. Keeping them here means either file can be read on its own.
 *
 * The routes only parse input and translate failures. Every rule lives in
 * `comment.service.ts`, and the tenant macro guarantees `:orgSlug` was resolved
 * from a verified membership before a handler runs.
 *
 * Used by: src/index.ts.
 */

import { Elysia, t } from "elysia";

import { authErrorMessage, authErrorStatus } from "../lib/auth-error";
import { tenantPlugin } from "../middleware/tenant";
import { publishRealtimeEvent } from "../realtime";
import {
	type CommentRealtimePayload,
	toRealtimeComment,
} from "../realtime/events";
import {
	type CommentListQuery,
	type CommentRow,
	createMilestoneComment,
	deleteMilestoneComment,
	getMilestoneCommentThread,
	listMilestoneComments,
	toggleMilestoneChecklistItem,
	updateMilestoneComment,
} from "../services/comment.service";

/** Every comment route lives under one milestone. */
const milestoneParams = t.Object({
	orgSlug: t.String({ minLength: 1, maxLength: 255 }),
	projectId: t.String({ minLength: 1, maxLength: 64 }),
	milestoneId: t.String({ minLength: 1, maxLength: 64 }),
});

/** One comment inside a milestone. */
const commentParams = t.Object({
	orgSlug: t.String({ minLength: 1, maxLength: 255 }),
	projectId: t.String({ minLength: 1, maxLength: 64 }),
	milestoneId: t.String({ minLength: 1, maxLength: 64 }),
	commentId: t.String({ minLength: 1, maxLength: 64 }),
});

const listQuery = t.Object({
	cursor: t.Optional(t.String({ maxLength: 200 })),
	limit: t.Optional(t.String()),
});

/**
 * The editor value.
 *
 * Deliberately untyped at the HTTP layer: the shape is a Plate document, and
 * the sanitizer in the service is the authority on what is accepted. A schema
 * here would have to be duplicated and kept in sync with the editor.
 */
const bodyField = t.Unknown();

/** Clamp the page size instead of trusting the browser. */
function parseCommentQuery(query: {
	cursor?: string;
	limit?: string;
}): CommentListQuery {
	const parsed = Number.parseInt(query.limit ?? "20", 10);
	const limit = Number.isFinite(parsed)
		? Math.min(50, Math.max(1, parsed))
		: 20;

	return {
		cursor: query.cursor ?? null,
		limit,
	};
}

/**
 * Publish one comment event after the service has committed.
 *
 * Why the route and not the service: the service owns rules, the route owns the
 * transport side effect, and the envelope needs the project id from the URL.
 * `publishRealtimeEvent` never rejects, so a realtime failure cannot turn a
 * successful save into an error.
 */
function publishCommentEvent(
	projectId: string,
	type: "comment.created" | "comment.updated" | "comment.deleted",
	milestoneId: string,
	comment: CommentRow,
	total: number | null,
): void {
	const payload: CommentRealtimePayload = {
		milestoneId,
		comment: toRealtimeComment(comment),
		total,
	};

	void publishRealtimeEvent(projectId, type, payload).catch(() => undefined);
}

export const commentRoutes = new Elysia({ name: "comments" })
	.use(tenantPlugin)
	/** One page of the discussion, newest page first, threads ascending. */
	.get(
		"/orgs/:orgSlug/projects/:projectId/milestones/:milestoneId/comments",
		async ({ tenant, status, params, query }) => {
			try {
				return await listMilestoneComments(
					tenant,
					params.projectId,
					params.milestoneId,
					parseCommentQuery(query),
				);
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not load the comments."),
				});
			}
		},
		{ tenant: true, params: milestoneParams, query: listQuery },
	)
	/** Post a comment, or a reply when `parentId` is set. */
	.post(
		"/orgs/:orgSlug/projects/:projectId/milestones/:milestoneId/comments",
		async ({ tenant, status, params, body }) => {
			try {
				const result = await createMilestoneComment(
					tenant,
					params.projectId,
					params.milestoneId,
					body,
				);

				publishCommentEvent(
					params.projectId,
					"comment.created",
					params.milestoneId,
					result.comment,
					result.total,
				);

				return result;
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not post the comment."),
				});
			}
		},
		{
			tenant: true,
			params: milestoneParams,
			body: t.Object({
				body: bodyField,
				parentId: t.Optional(
					t.Union([t.String({ minLength: 1, maxLength: 64 }), t.Null()]),
				),
			}),
		},
	)
	/** One complete thread, used by the focused comment tab. */
	.get(
		"/orgs/:orgSlug/projects/:projectId/milestones/:milestoneId/comments/:commentId/thread",
		async ({ tenant, status, params }) => {
			try {
				return await getMilestoneCommentThread(
					tenant,
					params.projectId,
					params.milestoneId,
					params.commentId,
				);
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not load the discussion."),
				});
			}
		},
		{ tenant: true, params: commentParams },
	)
	/**
	 * Flip one checklist item.
	 *
	 * Anyone who can comment may call this. It is separate from the edit route
	 * so checking an item never requires editing the text, and never marks the
	 * comment as edited.
	 */
	.patch(
		"/orgs/:orgSlug/projects/:projectId/milestones/:milestoneId/comments/:commentId/checklist",
		async ({ tenant, status, params, body }) => {
			try {
				const result = await toggleMilestoneChecklistItem(
					tenant,
					params.projectId,
					params.milestoneId,
					params.commentId,
					body,
				);

				publishCommentEvent(
					params.projectId,
					"comment.updated",
					params.milestoneId,
					result.comment,
					null,
				);

				return result;
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not update the checklist."),
				});
			}
		},
		{
			tenant: true,
			params: commentParams,
			body: t.Object({
				itemId: t.String({ minLength: 1, maxLength: 64 }),
				checked: t.Boolean(),
			}),
		},
	)
	/** Change the body of your own comment. */
	.patch(
		"/orgs/:orgSlug/projects/:projectId/milestones/:milestoneId/comments/:commentId",
		async ({ tenant, status, params, body }) => {
			try {
				const result = await updateMilestoneComment(
					tenant,
					params.projectId,
					params.milestoneId,
					params.commentId,
					body,
				);

				publishCommentEvent(
					params.projectId,
					"comment.updated",
					params.milestoneId,
					result.comment,
					null,
				);

				return result;
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not save the comment."),
				});
			}
		},
		{
			tenant: true,
			params: commentParams,
			body: t.Object({ body: bodyField }),
		},
	)
	/** Soft delete your own comment. */
	.delete(
		"/orgs/:orgSlug/projects/:projectId/milestones/:milestoneId/comments/:commentId",
		async ({ tenant, status, params }) => {
			try {
				const result = await deleteMilestoneComment(
					tenant,
					params.projectId,
					params.milestoneId,
					params.commentId,
				);

				publishCommentEvent(
					params.projectId,
					"comment.deleted",
					params.milestoneId,
					result.comment,
					result.total,
				);

				return result;
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not delete the comment."),
				});
			}
		},
		{ tenant: true, params: commentParams },
	);
