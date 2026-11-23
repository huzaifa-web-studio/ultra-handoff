/**
 * Due date reminder sweep.
 *
 * Why the sweep is per person and per local day: a due date is a calendar day,
 * not an instant. A single 09:00 UTC run is 14:00 in Karachi and 01:00 in
 * California, so it cannot produce "due today" for both. The worker runs every
 * hour and each recipient's own timezone decides whether their 09:00 has
 * arrived.
 *
 * Why the dedupe key includes the due date and the phase: the sweep can run
 * twice, a deploy can overlap two workers, and a due date can move. The unique
 * `(recipient, dedupe_key)` makes every repeat a no-op and lets a new due date
 * start a new series.
 *
 * Used by: queues/milestone-reminders.ts.
 */

import { and, eq, gte, inArray, lte, notInArray, sql } from "drizzle-orm";
import {
	milestone,
	milestoneAssignee,
	project,
	projectMember,
} from "../db/schema";
import type { TenantTx } from "../db/tenant";
import { dayDifference, localClock } from "../lib/timezone";
import type {
	NotificationCandidate,
	NotificationDelivery,
} from "./notification.service";
import {
	createNotifications,
	deleteNotificationsForRecipient,
	loadProjectManagerUserIds,
} from "./notification.service";
import { listOrganizationOwners } from "./organization.service";
import { loadUserTimezones } from "./user.service";

/** The local hour at which a reminder becomes eligible. */
export const REMINDER_LOCAL_HOUR = 9;

/** Milestones due further out than this are outside the sweep window. */
const UPCOMING_DAYS = 2;

/** Overdue reminders stop after this many days late. */
const MAX_OVERDUE_DAYS = 21;

/** The overdue days that still remind. */
const OVERDUE_DAYS = new Set([1, 7, 14, 21]);

/** Safety cap for one organization's sweep. */
const MAX_MILESTONES = 2_000;

/** The timezone used when a person has not reported one. */
export type ReminderTenant = {
	organizationId: string;
	slug: string;
};

/** One candidate milestone with the project context the copy needs. */
type ReminderMilestone = {
	id: string;
	title: string;
	dueDate: string;
	projectId: string;
	projectName: string;
	projectSlug: string;
};

/** `YYYY-MM-DD` in UTC, used only to bound the candidate query. */
function utcDay(offsetDays: number, now: Date): string {
	const shifted = new Date(now.getTime() + offsetDays * 86_400_000);

	return shifted.toISOString().slice(0, 10);
}

/**
 * Run one organization's reminder sweep.
 *
 * The caller has already opened `withTenant`, so every business read is subject
 * to the normal workspace policy. Nothing here writes outside that scope.
 */
export async function runReminderSweepForOrganization(
	tx: TenantTx,
	tenant: ReminderTenant,
	now: Date = new Date(),
): Promise<NotificationDelivery[]> {
	const from = utcDay(-MAX_OVERDUE_DAYS - 1, now);
	const to = utcDay(UPCOMING_DAYS, now);

	const rows = await tx
		.select({
			id: milestone.id,
			title: milestone.title,
			dueDate: milestone.dueDate,
			projectId: project.id,
			projectName: project.name,
			projectSlug: project.slug,
		})
		.from(milestone)
		.innerJoin(project, eq(milestone.projectId, project.id))
		.where(
			and(
				eq(milestone.organizationId, tenant.organizationId),
				sql`${project.archivedAt} is null`,
				notInArray(milestone.status, ["done", "cancelled"]),
				sql`${milestone.dueDate} is not null`,
				gte(milestone.dueDate, from),
				lte(milestone.dueDate, to),
			),
		)
		.limit(MAX_MILESTONES);

	const milestones: ReminderMilestone[] = rows.flatMap((row) =>
		row.dueDate
			? [
					{
						id: row.id,
						title: row.title,
						dueDate: row.dueDate,
						projectId: row.projectId,
						projectName: row.projectName,
						projectSlug: row.projectSlug,
					},
				]
			: [],
	);

	if (milestones.length === 0) return [];

	const milestoneIds = milestones.map((item) => item.id);

	// One read for every assignee of every candidate.
	const assigneeRows = await tx
		.select({
			milestoneId: milestoneAssignee.milestoneId,
			userId: projectMember.userId,
		})
		.from(milestoneAssignee)
		.innerJoin(
			projectMember,
			eq(milestoneAssignee.projectMemberId, projectMember.id),
		)
		.where(
			and(
				eq(milestoneAssignee.organizationId, tenant.organizationId),
				inArray(milestoneAssignee.milestoneId, milestoneIds),
			),
		);

	const assigneesByMilestone = new Map<string, string[]>();

	for (const row of assigneeRows) {
		const list = assigneesByMilestone.get(row.milestoneId) ?? [];
		list.push(row.userId);
		assigneesByMilestone.set(row.milestoneId, list);
	}

	// Unassigned milestones go to the people who can act on them. Organization
	// owners are always project owners, so they are included once per project.
	const fallbackByProject = new Map<string, string[]>();
	const missingProjects = [
		...new Set(
			milestones
				.filter(
					(item) => (assigneesByMilestone.get(item.id) ?? []).length === 0,
				)
				.map((item) => item.projectId),
		),
	];

	if (missingProjects.length > 0) {
		const owners = await listOrganizationOwners(tenant.organizationId);

		for (const projectId of missingProjects) {
			const managers = await loadProjectManagerUserIds(tx, tenant, projectId);
			fallbackByProject.set(projectId, [
				...new Set([...managers, ...owners.map((owner) => owner.userId)]),
			]);
		}
	}

	// Every recipient's zone in one read.
	const recipientIds = [
		...new Set([
			...assigneeRows.map((row) => row.userId),
			...[...fallbackByProject.values()].flat(),
		]),
	];
	const timezones = await loadUserTimezones(recipientIds);

	const candidates: NotificationCandidate[] = [];
	/**
	 * Unread "due tomorrow" rows that the today phase replaces.
	 *
	 * Why this exists: the dedupe key carries the phase, so the sweep would
	 * otherwise leave two live reminders for one due date. The tomorrow row is
	 * only removed when it is still unread; a read row stays as history.
	 */
	const replacedTomorrowRows: { recipientUserId: string; dedupeKey: string }[] =
		[];
	const projectView = new Map(
		milestones.map((item) => [
			item.projectId,
			{
				id: item.projectId,
				name: item.projectName,
				slug: item.projectSlug,
			},
		]),
	);

	for (const item of milestones) {
		const assigned = assigneesByMilestone.get(item.id) ?? [];
		const recipients =
			assigned.length > 0
				? assigned
				: (fallbackByProject.get(item.projectId) ?? []);

		if (recipients.length === 0) continue;

		for (const recipientUserId of new Set(recipients)) {
			const clock = localClock(now, timezones.get(recipientUserId) ?? "UTC");

			// The first sweep after 09:00 local delivers. A missed run still
			// delivers later the same day instead of being lost.
			if (clock.hour < REMINDER_LOCAL_HOUR) continue;

			const difference = dayDifference(clock.day, item.dueDate);
			const view = projectView.get(item.projectId);

			if (!view) continue;

			if (difference === 1 || difference === 0) {
				candidates.push({
					recipientUserId,
					actorUserId: null,
					type: "milestone_due_soon",
					dedupeKey: `due_soon:${item.id}:${recipientUserId}:${item.dueDate}:${difference === 1 ? "tomorrow" : "today"}`,
					project: view,
					milestone: { id: item.id, title: item.title },
					data: {
						dueDate: item.dueDate,
						phase: difference === 1 ? "tomorrow" : "today",
					},
				});

				if (difference === 0) {
					replacedTomorrowRows.push({
						recipientUserId,
						dedupeKey: `due_soon:${item.id}:${recipientUserId}:${item.dueDate}:tomorrow`,
					});
				}

				continue;
			}

			const daysLate = -difference;

			if (OVERDUE_DAYS.has(daysLate)) {
				candidates.push({
					recipientUserId,
					actorUserId: null,
					type: "milestone_overdue",
					dedupeKey: `overdue:${item.id}:${recipientUserId}:${item.dueDate}:${daysLate}`,
					project: view,
					milestone: { id: item.id, title: item.title },
					data: {
						dueDate: item.dueDate,
						daysLate,
					},
				});
			}
		}
	}

	if (candidates.length === 0) return [];

	const deliveries = await createNotifications(tx, tenant, candidates);

	/**
	 * Insert first, then drop the replaced row. A crash between the two leaves
	 * the old unread reminder in place rather than leaving none at all.
	 */
	if (replacedTomorrowRows.length > 0) {
		const byRecipient = new Map<string, string[]>();

		for (const row of replacedTomorrowRows) {
			const keys = byRecipient.get(row.recipientUserId) ?? [];
			keys.push(row.dedupeKey);
			byRecipient.set(row.recipientUserId, keys);
		}

		for (const [recipientUserId, dedupeKeys] of byRecipient) {
			await deleteNotificationsForRecipient(
				tx,
				tenant,
				recipientUserId,
				dedupeKeys,
				{ onlyUnread: true },
			);
		}
	}

	return deliveries;
}
