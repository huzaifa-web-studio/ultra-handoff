/**
 * Notification link decision tests.
 *
 * Why these exist: a click from an operating system alert carries a workspace
 * slug that may not be the active one. The three outcomes (same workspace,
 * switch, unknown) are the whole contract, and getting one wrong either drops
 * the alert or switches the person into a workspace they cannot open.
 */

import { describe, expect, it } from "bun:test";

import {
	decideNotificationLink,
	type NotificationLinkOrganization,
	readNotificationId,
} from "./link";

const other: NotificationLinkOrganization = {
	id: "org-b",
	name: "Studio B",
	slug: "studio-b",
};

describe("readNotificationId", () => {
	it("reads the parameter", () => {
		expect(readNotificationId("?notification=abc-123")).toBe("abc-123");
	});

	it("ignores a missing or empty value", () => {
		expect(readNotificationId("")).toBeNull();
		expect(readNotificationId("?milestoneTab=comments")).toBeNull();
		expect(readNotificationId("?notification=")).toBeNull();
	});

	it("ignores a value longer than an id can be", () => {
		expect(readNotificationId(`?notification=${"a".repeat(65)}`)).toBeNull();
	});
});

describe("decideNotificationLink", () => {
	it("does nothing without a click", () => {
		expect(
			decideNotificationLink({
				notificationId: null,
				urlSlug: "studio-a",
				activeSlug: "studio-a",
				organizations: [],
				organizationsPending: false,
			}),
		).toEqual({ kind: "none" });
	});

	it("does nothing while the active organization is unknown", () => {
		expect(
			decideNotificationLink({
				notificationId: "n-1",
				urlSlug: "studio-b",
				activeSlug: null,
				organizations: [other],
				organizationsPending: false,
			}),
		).toEqual({ kind: "none" });
	});

	it("leaves a same workspace click alone", () => {
		expect(
			decideNotificationLink({
				notificationId: "n-1",
				urlSlug: "studio-a",
				activeSlug: "studio-a",
				organizations: [other],
				organizationsPending: false,
			}),
		).toEqual({ kind: "same" });
	});

	it("switches to another workspace the person belongs to", () => {
		expect(
			decideNotificationLink({
				notificationId: "n-1",
				urlSlug: "studio-b",
				activeSlug: "studio-a",
				organizations: [other],
				organizationsPending: false,
			}),
		).toEqual({ kind: "switch", organization: other });
	});

	it("falls back when the workspace is not one of theirs", () => {
		expect(
			decideNotificationLink({
				notificationId: "n-1",
				urlSlug: "studio-c",
				activeSlug: "studio-a",
				organizations: [other],
				organizationsPending: false,
			}),
		).toEqual({ kind: "unknown" });
	});

	it("waits while the organization list is loading, then falls back", () => {
		const base = {
			notificationId: "n-1",
			urlSlug: "studio-b",
			activeSlug: "studio-a",
		};

		expect(
			decideNotificationLink({
				...base,
				organizations: undefined,
				organizationsPending: true,
			}),
		).toEqual({ kind: "wait" });

		expect(
			decideNotificationLink({
				...base,
				organizations: undefined,
				organizationsPending: false,
			}),
		).toEqual({ kind: "unknown" });
	});

	it("ignores a click on a page with no workspace", () => {
		expect(
			decideNotificationLink({
				notificationId: "n-1",
				urlSlug: undefined,
				activeSlug: "studio-a",
				organizations: [other],
				organizationsPending: false,
			}),
		).toEqual({ kind: "none" });
	});
});
