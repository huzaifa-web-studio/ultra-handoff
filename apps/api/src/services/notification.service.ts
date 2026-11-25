/**
 * Notification writing.
 *
 * Why the write side is separate from the read side: creating a notification
 * happens inside the business transaction that caused it, while listing and
 * marking read happen on a request scoped to the recipient. Keeping them in
 * separate modules also avoids a cycle, because the project service creates
 * notifications and the read side needs the project visibility helper.
 *
 * Rules:
 *   - every row is inserted in the same transaction as the write it describes,
 *     so a notification cannot exist for a save that rolled back
 *   - the actor is never a recipient
 *   - one row per recipient per subject, guarded by `(recipient, dedupe_key)`
 *   - recipients are resolved from project membership, never from request input
 *   - rendered copy is produced once per inserted row and returned as a
 *     delivery descriptor, so the route or worker can publish realtime and push
 *     without reading another person's notification under RLS
 *
 * Used by: comment, milestone, scope, change request, project and auth flows,
 * plus the reminder sweep.
 */

import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { milestoneAssignee, notification, projectMember } from "../db/schema";
import type { TenantTx } from "../db/tenant";
import type {
	NotificationData,
	NotificationType,
} from "../lib/notification-types";
import {
	type NotificationChangeRequestView,
	type NotificationCommentView,
	type NotificationConversationView,
	type NotificationMilestoneView,
	type NotificationProjectView,
	type NotificationScopeEntryView,
	notificationPreview,
	renderNotification,
} from "../lib/notifications";
import type { TenantContext } from "../middleware/tenant";
import { listOrganizationOwners } from "./organization.service";
import { loadUserMap } from "./user.service";

/**
 * One notification the caller wants to create.
 *
 * The view objects carry the names and ids the renderer needs. The emitter
 * already has them from the write it just performed, so no second query is
 * needed to build the sentence.
 */
export type NotificationCandidate = {
	recipientUserId: string;
	actorUserId?: string | null;
	type: NotificationType;
	dedupeKey: string;
	project?: NotificationProjectView | null;
	milestone?: NotificationMilestoneView | null;
	comment?: NotificationCommentView | null;
	changeRequest?: NotificationChangeRequestView | null;
	scopeEntry?: NotificationScopeEntryView | null;
	/** Set for a direct message notification. */
	conversation?: NotificationConversationView | null;
	data?: NotificationData;
	/** Used by organization-level copy such as a role change or invite accept. */
	organizationName?: string | null;
};

/**
 * One ready-to-deliver notification.
 *
 * Why this exists: the insert happens under the actor's scope, so the actor
 * cannot select the row back as the recipient. This descriptor carries the
 * id, the recipient and the rendered copy that the actor is already allowed to
 * know, which lets the transport publish and the push worker send without a
 * cross-user read.
 */
/**
 * The tenant fields the writer needs.
 *
 * Narrower than `TenantContext` so an auth hook or a background sweep can pass
 * only the workspace and the acting person, without inventing a membership row
 * for code that never reads one.
 */
export type NotificationTenant = Pick<TenantContext, "organizationId" | "slug">;

export type NotificationDelivery = {
	notificationId: string;
	organizationId: string;
	organizationSlug: string;
	recipientUserId: string;
	type: NotificationType;
	title: string;
	body: string;
	href: string;
	createdAt: string;
};

/** Safety cap for one fan-out. A project this size is already unusual. */
const MAX_CANDIDATES = 500;

/**
 * Create notifications and return their delivery descriptors.
 *
 * Missing recipients, the actor themselves and duplicate candidates in the
 * same call are dropped before the insert. The unique index then handles a
 * concurrent or retried call.
 */
export async function createNotifications(
	tx: TenantTx,
	tenant: NotificationTenant,
	candidates: NotificationCandidate[],
): Promise<NotificationDelivery[]> {
	const seen = new Set<string>();
	const accepted: NotificationCandidate[] = [];
	let truncated = 0;

	for (let index = 0; index < candidates.length; index += 1) {
		const candidate = candidates[index] as NotificationCandidate;

		if (!candidate.recipientUserId) continue;
		if (
			candidate.actorUserId &&
			candidate.recipientUserId === candidate.actorUserId
		) {
			continue;
		}

		const key = `${candidate.recipientUserId}:${candidate.dedupeKey}`;

		if (seen.has(key)) continue;

		seen.add(key);
		accepted.push(candidate);

		if (accepted.length >= MAX_CANDIDATES) {
			truncated = candidates.length - index - 1;
			break;
		}
	}

	/**
	 * The cap is a safety net for a malformed call, not normal behaviour. The
	 * organization seat limit keeps a real fan-out below it, so a truncated
	 * list means a caller built candidates it should not have. Logging the
	 * tenant and both counts makes the silent loss visible without changing the
	 * behaviour that protects the transaction.
	 */
	if (truncated > 0) {
		console.error(
			`[notifications] fan-out truncated organization=${tenant.organizationId} accepted=${accepted.length} dropped=${truncated}`,
		);
	}

	if (accepted.length === 0) return [];

	/**
	 * Insert one recipient's rows while the transaction is scoped to them.
	 *
	 * Why the user setting is switched: the notification INSERT policy is
	 * workspace wide because one person's action creates another person's row,
	 * but the SELECT policy is recipient only. Postgres applies the SELECT
	 * policy to `RETURNING`, so a batch insert under the actor's scope would
	 * insert successfully and then return nothing. Scoping to the recipient for
	 * the insert lets `RETURNING` echo exactly the row just written, then the
	 * original actor scope is restored before the transaction does any other
	 * work.
	 *
	 * The cost is one insert per recipient, not one per event. Fan-out is
	 * bounded by MAX_CANDIDATES and is human driven, so this stays small.
	 */
	const [scopeRow] = await tx.execute<{ usr: string | null }>(
		sql`select current_setting('app.current_user_id', true) as usr`,
	);
	const originalUser = scopeRow?.usr ?? "";
	const byRecipient = new Map<string, NotificationCandidate[]>();

	for (const candidate of accepted) {
		const list = byRecipient.get(candidate.recipientUserId) ?? [];
		list.push(candidate);
		byRecipient.set(candidate.recipientUserId, list);
	}

	const inserted: (typeof notification.$inferSelect)[] = [];

	try {
		for (const [recipientUserId, candidates] of byRecipient) {
			await tx.execute(
				sql`select set_config('app.current_user_id', ${recipientUserId}, true)`,
			);

			const rows = await tx
				.insert(notification)
				.values(
					candidates.map((candidate) => ({
						id: randomUUID(),
						organizationId: tenant.organizationId,
						recipientUserId,
						actorUserId: candidate.actorUserId ?? null,
						type: candidate.type,
						dedupeKey: candidate.dedupeKey,
						projectId: candidate.project?.id ?? null,
						milestoneId: candidate.milestone?.id ?? null,
						commentId: candidate.comment?.id ?? null,
						changeRequestId: candidate.changeRequest?.id ?? null,
						scopeEntryId: candidate.scopeEntry?.id ?? null,
						conversationId: candidate.conversation?.id ?? null,
						data: candidate.data ?? {},
					})),
				)
				.onConflictDoNothing({
					target: [notification.recipientUserId, notification.dedupeKey],
				})
				.returning();

			inserted.push(...rows);
		}
	} finally {
		// The rest of the business transaction must continue as the actor. If
		// the insert already aborted the transaction, this restore is the one
		// statement that must not mask the original error.
		if (originalUser) {
			await tx
				.execute(
					sql`select set_config('app.current_user_id', ${originalUser}, true)`,
				)
				.catch(() => undefined);
		}
	}

	if (inserted.length === 0) return [];

	const candidateByKey = new Map(
		accepted.map((candidate) => [
			`${candidate.recipientUserId}:${candidate.dedupeKey}`,
			candidate,
		]),
	);

	// One read for every actor name on the page. Reminders have no actor, so
	// this is often skipped entirely.
	const actorIds = [
		...new Set(
			inserted
				.map((row) => row.actorUserId)
				.filter((id): id is string => Boolean(id)),
		),
	];
	const people = await loadUserMap(actorIds);

	const deliveries: NotificationDelivery[] = [];

	for (const row of inserted) {
		const candidate = candidateByKey.get(
			`${row.recipientUserId}:${row.dedupeKey}`,
		);

		if (!candidate) continue;

		const person = row.actorUserId ? people.get(row.actorUserId) : undefined;
		const rendered = renderNotification({
			type: candidate.type,
			actorName: person?.name || person?.email || null,
			organizationSlug: tenant.slug,
			organizationName: candidate.organizationName ?? null,
			project: candidate.project ?? null,
			milestone: candidate.milestone ?? null,
			comment: candidate.comment
				? {
						...candidate.comment,
						preview: notificationPreview(candidate.comment.preview),
					}
				: null,
			changeRequest: candidate.changeRequest ?? null,
			scopeEntry: candidate.scopeEntry ?? null,
			conversation: candidate.conversation ?? null,
			data: candidate.data ?? {},
		});

		deliveries.push({
			notificationId: row.id,
			organizationId: row.organizationId,
			organizationSlug: tenant.slug,
			recipientUserId: row.recipientUserId,
			type: row.type as NotificationType,
			title: rendered.title,
			body: rendered.body,
			href: rendered.href,
			createdAt: row.createdAt.toISOString(),
		});
	}

	return deliveries;
}

/**
 * Delete rows the actor caused for another person.
 *
 * Why recipient scope: the DELETE policy reads the row first, and only the
 * recipient can see it. The actor caused the row, so the recipient is known and
 * the transaction can be scoped to them for this one statement, exactly like
 * the insert above. The setting is restored afterwards so the rest of the
 * business transaction keeps running as the actor.
 *
 * `onlyUnread` keeps read history intact: a reminder that was already read is
 * allowed to stay when a newer phase replaces it.
 */
export async function deleteNotificationsForRecipient(
	tx: TenantTx,
	tenant: NotificationTenant,
	recipientUserId: string,
	dedupeKeys: string[],
	options?: { onlyUnread?: boolean },
): Promise<number> {
	if (dedupeKeys.length === 0) return 0;

	const [scopeRow] = await tx.execute<{ usr: string | null }>(
		sql`select current_setting('app.current_user_id', true) as usr`,
	);
	const originalUser = scopeRow?.usr ?? "";
	let deleted = 0;

	try {
		await tx.execute(
			sql`select set_config('app.current_user_id', ${recipientUserId}, true)`,
		);

		const rows = await tx
			.delete(notification)
			.where(
				and(
					eq(notification.organizationId, tenant.organizationId),
					eq(notification.recipientUserId, recipientUserId),
					inArray(notification.dedupeKey, dedupeKeys),
					...(options?.onlyUnread ? [isNull(notification.readAt)] : []),
				),
			)
			.returning({ id: notification.id });

		deleted = rows.length;
	} finally {
		// Same reasoning as the insert restore: a failed delete must not mask
		// the original error, but the transaction must still continue as the
		// actor.
		if (originalUser) {
			await tx
				.execute(
					sql`select set_config('app.current_user_id', ${originalUser}, true)`,
				)
				.catch(() => undefined);
		}
	}

	return deleted;
}

/**
 * Delete every notification that points at one comment.
 *
 * Why a database function: the author deleting their comment has to clean up
 * rows that belong to many recipients, and the author can read none of them
 * under the recipient scoped SELECT policy. The function runs as its owner and
 * scopes itself to the current workspace, so a caller cannot reach another
 * tenant. The function itself lives in scripts/bootstrap-db.ts.
 */
export async function deleteCommentNotifications(
	tx: TenantTx,
	commentId: string,
): Promise<number> {
	const rows = await tx.execute<{ count: number }>(
		sql`select public.delete_comment_notifications(${commentId}) as count`,
	);

	return rows[0]?.count ?? 0;
}

/** Everyone assigned to one milestone. */
export async function loadMilestoneAssigneeUserIds(
	tx: TenantTx,
	tenant: NotificationTenant,
	milestoneId: string,
): Promise<string[]> {
	const rows = await tx
		.select({ userId: projectMember.userId })
		.from(milestoneAssignee)
		.innerJoin(
			projectMember,
			eq(milestoneAssignee.projectMemberId, projectMember.id),
		)
		.where(
			and(
				eq(milestoneAssignee.organizationId, tenant.organizationId),
				eq(milestoneAssignee.milestoneId, milestoneId),
			),
		);

	return [...new Set(rows.map((row) => row.userId))];
}

/** Everyone on a project, optionally narrowed to one or more roles. */
export async function loadProjectMemberUserIds(
	tx: TenantTx,
	tenant: NotificationTenant,
	projectId: string,
	roles?: readonly string[],
): Promise<string[]> {
	const rows = await tx
		.select({ userId: projectMember.userId })
		.from(projectMember)
		.where(
			and(
				eq(projectMember.organizationId, tenant.organizationId),
				eq(projectMember.projectId, projectId),
				...(roles && roles.length > 0
					? [inArray(projectMember.role, [...roles])]
					: []),
			),
		);

	return [...new Set(rows.map((row) => row.userId))];
}

/**
 * Project owners, admins and organization owners.
 *
 * Organization owners are always project owners in the product, even when a
 * project membership row has not been materialized yet, so they are added
 * explicitly. The lookup is privileged because `member` belongs to Better Auth.
 */
export async function loadProjectManagerUserIds(
	tx: TenantTx,
	tenant: NotificationTenant,
	projectId: string,
): Promise<string[]> {
	const [members, owners] = await Promise.all([
		loadProjectMemberUserIds(tx, tenant, projectId, ["owner", "admin"]),
		listOrganizationOwners(tenant.organizationId),
	]);

	return [...new Set([...members, ...owners.map((owner) => owner.userId)])];
}
