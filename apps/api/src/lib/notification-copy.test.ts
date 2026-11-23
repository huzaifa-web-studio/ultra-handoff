/**
 * QA unit tests for the notification feature (no database).
 */

import { describe, expect, test } from "bun:test";
import {
	computeThreadUnread,
	type ReadableComment,
} from "../services/comment-read.service";
import {
	COMMENT_NOTIFICATION_TYPES,
	isCommentNotificationType,
	isNotificationType,
	NOTIFICATION_TYPE_SQL_VALUES,
	NOTIFICATION_TYPES,
	REMINDER_NOTIFICATION_TYPES,
} from "./notification-types";
import {
	type NotificationRenderInput,
	notificationHref,
	notificationPreview,
	renderNotification,
} from "./notifications";
import {
	dayDifference,
	formatCalendarDay,
	localClock,
	normalizeTimezone,
} from "./timezone";

const base: NotificationRenderInput = {
	type: "mention",
	actorName: "Sara",
	organizationSlug: "acme",
	organizationName: "Acme Studio",
	project: { id: "p1", name: "Website", slug: "website" },
	milestone: { id: "m1", title: "Homepage" },
	comment: null,
	changeRequest: null,
	scopeEntry: null,
	data: {},
};

describe("notification vocabulary", () => {
	test("every declared type is recognised and injected into the SQL allowlist", () => {
		for (const type of NOTIFICATION_TYPES) {
			expect(isNotificationType(type)).toBe(true);
			expect(NOTIFICATION_TYPE_SQL_VALUES).toContain(`'${type}'`);
		}

		expect(isNotificationType("not_a_type")).toBe(false);
		expect(isNotificationType(null)).toBe(false);
		expect(isNotificationType(42)).toBe(false);
	});

	test("comment and reminder groupings only contain declared types", () => {
		for (const type of COMMENT_NOTIFICATION_TYPES) {
			expect(isNotificationType(type)).toBe(true);
			expect(isCommentNotificationType(type)).toBe(true);
		}

		for (const type of REMINDER_NOTIFICATION_TYPES) {
			expect(isNotificationType(type)).toBe(true);
			expect(isCommentNotificationType(type)).toBe(false);
		}
	});
});

describe("notificationPreview", () => {
	test("collapses whitespace and trims", () => {
		expect(notificationPreview("\n  hello \t world  \n")).toBe("hello world");
	});

	test("returns null for empty or whitespace only input", () => {
		expect(notificationPreview(null)).toBeNull();
		expect(notificationPreview("")).toBeNull();
		expect(notificationPreview("   \n\t ")).toBeNull();
	});

	test("truncates to a single short line with an ellipsis", () => {
		const long = "a".repeat(300);
		const preview = notificationPreview(long);

		expect(preview).not.toBeNull();
		expect(preview?.length).toBe(120);
		expect(preview?.endsWith("...")).toBe(true);
	});

	test("leaves a 120 character preview untouched", () => {
		const exact = "b".repeat(120);
		expect(notificationPreview(exact)).toBe(exact);
	});
});

describe("notificationHref", () => {
	test("encodes the workspace slug", () => {
		expect(
			notificationHref({ ...base, organizationSlug: "weird slug/one" }),
		).toContain("/weird%20slug%2Fone");
	});

	test("a reply deep links to the thread root, not the reply", () => {
		const href = notificationHref({
			...base,
			comment: { id: "reply-1", parentId: "root-1", preview: null },
		});

		expect(href).toContain("milestoneTab=comment%3Aroot-1");
		expect(href).not.toContain("reply-1");
	});

	test("a root comment deep links to itself", () => {
		const href = notificationHref({
			...base,
			comment: { id: "root-1", parentId: null, preview: null },
		});

		expect(href).toContain("milestoneTab=comment%3Aroot-1");
	});

	test("a scope mention links to its scope section", () => {
		const href = notificationHref({
			...base,
			scopeEntry: { id: "s1", title: "Login" },
		});

		expect(href).toContain("milestoneTab=scope%3As1");
	});

	test("a project notification without a milestone links to the project", () => {
		expect(notificationHref({ ...base, milestone: null })).toBe(
			"/acme/projects/website",
		);
	});

	test("an organization event with no project links to members", () => {
		expect(
			notificationHref({
				...base,
				type: "member_joined",
				project: null,
				milestone: null,
			}),
		).toBe("/acme/settings/members");
	});
});

describe("renderNotification", () => {
	test("every type renders without placeholders", () => {
		for (const type of NOTIFICATION_TYPES) {
			const rendered = renderNotification({
				...base,
				type,
				organizationName: "Acme Studio",
				data: {
					status: "in_review",
					decision: "accepted",
					role: "admin",
					phase: "tomorrow",
					dueDate: "2026-11-24",
					daysLate: 7,
					from: "member",
					to: "admin",
				},
				comment: { id: "c1", parentId: null, preview: "Please check" },
				changeRequest: { id: "cr1", title: "Add a page" },
			});

			expect(rendered.title.length).toBeGreaterThan(0);
			expect(rendered.body.length).toBeGreaterThan(0);
			expect(rendered.href.startsWith("/")).toBe(true);
			expect(rendered.body).not.toContain("undefined");
			expect(rendered.body).not.toContain("null");
			expect(rendered.body).not.toContain("NaN");
			expect(rendered.body).not.toContain("[object");
		}
	});

	test("falls back to neutral names when the actor or source row is missing", () => {
		const rendered = renderNotification({
			...base,
			actorName: null,
			project: null,
			milestone: null,
			type: "milestone_assigned",
		});

		expect(rendered.body).toBe("Someone assigned you to a milestone.");
	});

	test("single day overdue uses the singular word", () => {
		const rendered = renderNotification({
			...base,
			type: "milestone_overdue",
			data: { dueDate: "2026-11-22", daysLate: 1 },
		});

		expect(rendered.body).toBe("Homepage is 1 day overdue (22 Nov 2026).");
	});

	test("unknown enum values fall back to the raw string", () => {
		const rendered = renderNotification({
			...base,
			type: "milestone_status",
			data: { status: "brand_new" },
		});

		expect(rendered.body).toBe("Homepage moved to brand_new.");
	});
});

describe("computeThreadUnread", () => {
	const baseline = new Date("2026-11-01T00:00:00Z");
	const row = (
		id: string,
		overrides: Partial<ReadableComment> = {},
	): ReadableComment => ({
		id,
		authorId: "other",
		kind: "comment",
		createdAt: new Date("2026-11-02T10:00:00Z"),
		deletedAt: null,
		...overrides,
	});

	test("a cursor id that no longer exists restarts the count after the baseline", () => {
		const result = computeThreadUnread({
			comments: [row("a"), row("b")],
			viewerId: "me",
			baselineAt: baseline,
			cursorId: "deleted-root",
		});

		expect(result).toEqual({ count: 2, firstUnreadCommentId: "a" });
	});

	test("ignores activity rows and deleted rows", () => {
		const result = computeThreadUnread({
			comments: [
				row("event", { kind: "event" }),
				row("deleted", { deletedAt: new Date() }),
				row("a"),
			],
			viewerId: "me",
			baselineAt: baseline,
			cursorId: null,
		});

		expect(result).toEqual({ count: 1, firstUnreadCommentId: "a" });
	});

	test("ties are ordered by id", () => {
		const same = new Date("2026-11-02T10:00:00Z");
		const result = computeThreadUnread({
			comments: [
				row("zzz", { createdAt: same }),
				row("aaa", { createdAt: same }),
			],
			viewerId: "me",
			baselineAt: baseline,
			cursorId: null,
		});

		expect(result.firstUnreadCommentId).toBe("aaa");
	});
});

describe("timezone helpers", () => {
	test("trims a valid IANA name", () => {
		expect(normalizeTimezone(" Europe/London ")).toBe("Europe/London");
	});

	test("Intl accepts a lower case zone and the value is stored as typed", () => {
		// Documents current behaviour: validation is case insensitive, and the
		// raw trimmed string is stored rather than the canonical casing.
		expect(normalizeTimezone("europe/london")).toBe("europe/london");
		expect(normalizeTimezone("Mars/Olympus")).toBeNull();
		expect(normalizeTimezone("UTC; drop table")).toBeNull();
	});

	test("reminder eligibility: 08:59 is too early, 09:00 is eligible", () => {
		const early = localClock(new Date("2026-11-23T08:59:00Z"), "UTC");
		const onTime = localClock(new Date("2026-11-23T09:00:00Z"), "UTC");

		expect(early.hour).toBe(8);
		expect(onTime.hour).toBe(9);
	});

	test("localClock handles a half hour offset", () => {
		const kolkata = localClock(
			new Date("2026-11-23T03:45:00Z"),
			"Asia/Kolkata",
		);

		expect(kolkata).toEqual({ day: "2026-11-23", hour: 9 });
	});

	test("dayDifference counts calendar days only", () => {
		expect(dayDifference("2026-11-23", "2026-11-24")).toBe(1);
		expect(dayDifference("2026-11-23", "2026-11-23")).toBe(0);
		expect(dayDifference("2026-11-23", "2026-11-22")).toBe(-1);
	});

	test("formatCalendarDay rejects a malformed value without throwing", () => {
		expect(formatCalendarDay("not-a-date")).toBe("not-a-date");
	});
});
