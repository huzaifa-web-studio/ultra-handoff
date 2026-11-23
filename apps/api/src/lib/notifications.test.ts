/**
 * Tests for notification copy and links.
 *
 * The same renderer feeds the bell, the full page and the push payload, so a
 * broken link or an unformatted date would reach every surface at once.
 *
 * Used by: lib/notifications.ts.
 */

import { describe, expect, test } from "bun:test";

import { notificationHref, renderNotification } from "./notifications";

const base = {
	type: "mention" as const,
	actorName: "Sara",
	organizationSlug: "acme",
	organizationName: "Acme",
	project: { id: "p1", name: "Website", slug: "website" },
	milestone: { id: "m1", title: "Homepage" },
	comment: null,
	changeRequest: null,
	scopeEntry: null,
	data: {},
};

describe("notificationHref", () => {
	test("links a mention to its thread root", () => {
		expect(
			notificationHref({
				...base,
				comment: { id: "reply", parentId: "root", preview: null },
			}),
		).toBe(
			"/acme/projects/website/milestones?milestone=m1&milestoneTab=comment%3Aroot",
		);
	});

	test("links a change request to the changes tab", () => {
		expect(
			notificationHref({
				...base,
				changeRequest: { id: "c1", title: "Add a page" },
			}),
		).toBe(
			"/acme/projects/website/milestones?milestone=m1&milestoneTab=changes",
		);
	});

	test("links an organization event to members", () => {
		expect(
			notificationHref({
				...base,
				type: "org_role_changed",
				project: null,
				milestone: null,
			}),
		).toBe("/acme/settings/members");
	});
});

describe("renderNotification", () => {
	test("includes a short comment preview in a mention", () => {
		const rendered = renderNotification({
			...base,
			comment: { id: "c1", parentId: null, preview: "Can you check this?" },
		});

		expect(rendered.title).toBe("New mention");
		expect(rendered.body).toContain("Can you check this?");
	});

	test("formats a due date as day month year", () => {
		const rendered = renderNotification({
			...base,
			type: "milestone_due_soon",
			data: { phase: "today", dueDate: "2026-11-03" },
		});

		expect(rendered.body).toBe("Homepage is due today, 3 Nov 2026.");
	});

	test("names the previous and new organization role", () => {
		const rendered = renderNotification({
			...base,
			type: "org_role_changed",
			project: null,
			milestone: null,
			data: { from: "member", to: "admin" },
		});

		expect(rendered.body).toBe(
			"Your role in Acme changed from Member to Admin.",
		);
	});
});
