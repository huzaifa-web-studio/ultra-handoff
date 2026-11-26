/**
 * Notification copy and links.
 *
 * Why one renderer: the same sentence appears in the bell, in the full list and
 * in the operating system alert or push payload. Rendering it in one place
 * means those three surfaces cannot drift, and a date can never be formatted
 * one way in the list and another in a push.
 *
 * The renderer is pure. The service supplies names and ids from joins, and the
 * emitter supplies the same shape from the write it just committed. The row
 * itself never stores rendered text, so a renamed project appears correctly in
 * the list while a push sent at the moment of the event reads naturally.
 *
 * Used by: services/notification.service.ts and the services that create
 * notifications.
 */

import type { NotificationData, NotificationType } from "./notification-types";
import { formatCalendarDay } from "./timezone";

/** The project a notification points at, if any. */
export type NotificationProjectView = {
	id: string;
	name: string;
	slug: string;
};

/** The milestone a notification points at, if any. */
export type NotificationMilestoneView = {
	id: string;
	title: string;
};

/** The comment a notification points at, if any. */
export type NotificationCommentView = {
	id: string;
	/** The thread root. Null when the comment itself is a root. */
	parentId: string | null;
	/** Plain text excerpt, already truncated by the service. */
	preview: string | null;
};

/** The change request a notification points at, if any. */
export type NotificationChangeRequestView = {
	id: string;
	title: string;
};

/** The scope section a notification points at, if any. */
export type NotificationScopeEntryView = {
	id: string;
	title: string;
};

/** Everything the renderer needs. */
export type NotificationRenderInput = {
	type: NotificationType;
	actorName: string | null;
	organizationSlug: string;
	organizationName: string | null;
	project: NotificationProjectView | null;
	milestone: NotificationMilestoneView | null;
	comment: NotificationCommentView | null;
	changeRequest: NotificationChangeRequestView | null;
	scopeEntry: NotificationScopeEntryView | null;
	/** Set for a direct message, so the click opens the conversation. */
	conversation?: NotificationConversationView | null;
	data: NotificationData;
};

/** The conversation a direct message notification points at. */
export type NotificationConversationView = {
	id: string;
	/** The channel name. Null for a direct conversation, whose name is a person. */
	title?: string | null;
};

/** The three strings every notification surface displays. */
export type RenderedNotification = {
	title: string;
	body: string;
	href: string;
};

/** Display labels for the milestone status vocabulary. */
const STATUS_LABELS: Record<string, string> = {
	todo: "To do",
	in_development: "In development",
	in_testing: "In testing",
	ready: "Ready",
	in_review: "In review",
	blocked: "Blocked",
	done: "Done",
	cancelled: "Cancelled",
};

/** Display labels for organization and project roles. */
const ROLE_LABELS: Record<string, string> = {
	owner: "Owner",
	admin: "Admin",
	member: "Member",
	client: "Client",
};

/** Display labels for a change request decision. */
const DECISION_LABELS: Record<string, string> = {
	accepted: "accepted",
	declined: "declined",
	moved: "moved",
};

/** Read a string from the data object without trusting its runtime shape. */
function dataString(data: NotificationData, key: string): string | null {
	const value = data[key];

	return typeof value === "string" && value.length > 0 ? value : null;
}

/** Read a number from the data object. */
function dataNumber(data: NotificationData, key: string): number | null {
	const value = data[key];

	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Squash a rich text mirror into one short line.
 *
 * The body mirror can contain newlines from paragraphs and lists. An operating
 * system alert has one line, so whitespace is collapsed before truncation.
 */
export function notificationPreview(value: string | null): string | null {
	if (!value) return null;

	const squashed = value.replace(/\s+/g, " ").trim();

	if (squashed.length === 0) return null;
	if (squashed.length <= 120) return squashed;

	return `${squashed.slice(0, 117).trimEnd()}...`;
}

/** Fall back to a neutral name when the actor account was deleted. */
function actorName(input: NotificationRenderInput): string {
	return input.actorName ?? "Someone";
}

/** Build the in-app path for a notification. */
export function notificationHref(input: NotificationRenderInput): string {
	const base = `/${encodeURIComponent(input.organizationSlug)}`;
	const organizationOnly =
		input.type === "member_joined" || input.type === "org_role_changed";

	// A conversation is not project scoped, so it answers before the project
	// branch. The messages page owns the deep link. A reply carries its root in
	// `data`, so the bell lands on the thread that actually has the new reply
	// instead of a timeline that cannot show it.
	if (
		(input.type === "direct_message" || input.type === "group_message") &&
		input.conversation
	) {
		const conversationPath = `${base}/messages/${encodeURIComponent(input.conversation.id)}`;
		const threadRootId = input.data.threadRootId;

		return typeof threadRootId === "string" && threadRootId.length > 0
			? `${conversationPath}/threads/${encodeURIComponent(threadRootId)}`
			: conversationPath;
	}

	if (!input.project) {
		return organizationOnly ? `${base}/settings/members` : base;
	}

	const projectPath = `${base}/projects/${encodeURIComponent(input.project.slug)}`;

	if (!input.milestone) return projectPath;

	const query = new URLSearchParams({ milestone: input.milestone.id });

	if (input.comment) {
		// A reply deep links to its root, which is the tab the reader can open.
		const rootId = input.comment.parentId ?? input.comment.id;
		query.set("milestoneTab", `comment:${rootId}`);
	} else if (input.changeRequest) {
		query.set("milestoneTab", "changes");
	} else if (input.scopeEntry) {
		query.set("milestoneTab", `scope:${input.scopeEntry.id}`);
	}

	return `${projectPath}/milestones?${query.toString()}`;
}

/** The milestone title, or a neutral fallback for a missing row. */
function milestoneName(input: NotificationRenderInput): string {
	return input.milestone?.title ?? "a milestone";
}

/** The project name, or a neutral fallback for a missing row. */
function projectName(input: NotificationRenderInput): string {
	return input.project?.name ?? "a project";
}

/** The organization name, or a neutral fallback. */
function organizationName(input: NotificationRenderInput): string {
	return input.organizationName ?? "your organization";
}

/**
 * Render one notification.
 *
 * Every branch returns a title, a one line body and a relative path. The body
 * never contains rich text or HTML: it is plain text for a list row and an
 * operating system alert.
 */
export function renderNotification(
	input: NotificationRenderInput,
): RenderedNotification {
	const actor = actorName(input);
	const milestone = milestoneName(input);
	const project = projectName(input);
	const organization = organizationName(input);
	const preview = input.comment?.preview ?? null;
	const withPreview = (sentence: string) =>
		preview ? `${sentence} "${preview}"` : sentence;

	switch (input.type) {
		case "mention": {
			const where = input.comment
				? `a comment on ${milestone}`
				: input.scopeEntry
					? `the scope of ${milestone}`
					: input.changeRequest
						? `a change request on ${milestone}`
						: `the description of ${milestone}`;

			return {
				title: "New mention",
				body: withPreview(`${actor} mentioned you in ${where}.`),
				href: notificationHref(input),
			};
		}
		case "comment_reply":
			return {
				title: "New reply",
				body: withPreview(`${actor} replied to your comment on ${milestone}.`),
				href: notificationHref(input),
			};
		case "comment_new":
			return {
				title: "New comment",
				body: withPreview(`${actor} commented on ${milestone}.`),
				href: notificationHref(input),
			};
		case "milestone_assigned":
			return {
				title: "Assigned to you",
				body: `${actor} assigned you to ${milestone}.`,
				href: notificationHref(input),
			};
		case "milestone_status": {
			const status = dataString(input.data, "status");
			const label = status ? (STATUS_LABELS[status] ?? status) : "a new status";

			return {
				title: "Milestone status changed",
				body: `${milestone} moved to ${label}.`,
				href: notificationHref(input),
			};
		}
		case "scope_locked":
			return {
				title: "Scope locked",
				body: `${actor} locked the scope of ${milestone}.`,
				href: notificationHref(input),
			};
		case "scope_unlocked":
			return {
				title: "Scope unlocked",
				body: `${actor} unlocked the scope of ${milestone}.`,
				href: notificationHref(input),
			};
		case "change_request_created":
			return {
				title: "New change request",
				body: `${actor} requested a change on ${milestone}: ${input.changeRequest?.title ?? "a change request"}.`,
				href: notificationHref(input),
			};
		case "change_request_decided": {
			const decision = dataString(input.data, "decision");
			const label = decision
				? (DECISION_LABELS[decision] ?? decision)
				: "decided";

			return {
				title: "Change request updated",
				body: `${actor} ${label} your change request on ${milestone}.`,
				href: notificationHref(input),
			};
		}
		case "change_request_withdrawn":
			return {
				title: "Change request withdrawn",
				body: `${actor} withdrew a change request on ${milestone}.`,
				href: notificationHref(input),
			};
		case "project_member_added":
			return {
				title: "Added to a project",
				body: `${actor} added you to ${project}.`,
				href: notificationHref(input),
			};
		case "project_role_changed": {
			const role = dataString(input.data, "role");
			const label = role ? (ROLE_LABELS[role] ?? role) : "a new role";

			return {
				title: "Project role changed",
				body: `Your role in ${project} changed to ${label}.`,
				href: notificationHref(input),
			};
		}
		case "member_joined":
			return {
				title: "Invitation accepted",
				body: `${actor} joined ${organization}.`,
				href: notificationHref(input),
			};
		case "milestone_due_soon": {
			const phase = dataString(input.data, "phase");
			const dueDate = dataString(input.data, "dueDate");
			const when = phase === "tomorrow" ? "tomorrow" : "today";
			const date = dueDate ? `, ${formatCalendarDay(dueDate)}` : "";

			return {
				title:
					phase === "tomorrow"
						? "Milestone due tomorrow"
						: "Milestone due today",
				body: `${milestone} is due ${when}${date}.`,
				href: notificationHref(input),
			};
		}
		case "milestone_overdue": {
			const dueDate = dataString(input.data, "dueDate");
			const daysLate = dataNumber(input.data, "daysLate");
			const date = dueDate ? ` (${formatCalendarDay(dueDate)})` : "";
			const late =
				daysLate === null
					? "is overdue"
					: `is ${daysLate} ${daysLate === 1 ? "day" : "days"} overdue`;

			return {
				title: "Milestone overdue",
				body: `${milestone} ${late}${date}.`,
				href: notificationHref(input),
			};
		}
		case "org_role_changed": {
			const from = dataString(input.data, "from");
			const to = dataString(input.data, "to");
			const fromLabel = from
				? (ROLE_LABELS[from] ?? from)
				: "your previous role";
			const toLabel = to ? (ROLE_LABELS[to] ?? to) : "a new role";

			return {
				title: "Your role changed",
				body: `Your role in ${organization} changed from ${fromLabel} to ${toLabel}.`,
				href: notificationHref(input),
			};
		}
		case "project_archived":
			return {
				title: "Project archived",
				body: `${actor} archived ${project}.`,
				href: notificationHref(input),
			};
		case "project_unarchived":
			return {
				title: "Project restored",
				body: `${actor} restored ${project}.`,
				href: notificationHref(input),
			};
		case "direct_message": {
			const preview = notificationPreview(
				dataString(input.data, "preview") ?? null,
			);

			return {
				title: "New message",
				body: preview
					? `${actor} sent you a message "${preview}"`
					: `${actor} sent you a message.`,
				href: notificationHref(input),
			};
		}
		case "group_message": {
			const preview = notificationPreview(
				dataString(input.data, "preview") ?? null,
			);
			const channel = input.conversation?.title
				? `#${input.conversation.title}`
				: "a channel";

			return {
				title: `New message in ${channel}`,
				body: preview
					? `${actor} in ${channel}: "${preview}"`
					: `${actor} sent a message in ${channel}.`,
				href: notificationHref(input),
			};
		}
	}
}
