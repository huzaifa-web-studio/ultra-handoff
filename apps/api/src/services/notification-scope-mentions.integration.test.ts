/**
 * Scope mention lifecycle checks.
 *
 * Why a separate file: the suite is split by scenario so each file stays
 * readable. The seed and helpers live in `notification-fixtures.ts`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { sql } from "drizzle-orm";

import { adminDb } from "../db";
import { milestoneScopeEntry } from "../db/schema";

import { updateMilestoneScopeEntry } from "./milestone/scope";
import {
	cleanupNotificationFixture,
	clearNotifications,
	ids,
	mentionBody,
	paragraph,
	rowsFor,
	seedNotificationFixture,
	suffix,
	suite,
	tOwner,
} from "./notification-fixtures";

suite("notification scope mentions", () => {
	beforeAll(seedNotificationFixture);
	afterAll(cleanupNotificationFixture);

	describe("scope mention lifecycle", () => {
		const entryId = `qa-notif-scope-${suffix}`;

		async function seedEntry() {
			await adminDb.execute(
				sql`delete from "milestone_scope_entry" where id = ${entryId}`,
			);
			await adminDb.insert(milestoneScopeEntry).values({
				id: entryId,
				organizationId: ids.orgA,
				projectId: ids.pMain,
				milestoneId: ids.mComment,
				kind: "change",
				title: "Scope section",
				body: paragraph("empty"),
				bodyText: "empty",
				createdBy: ids.owner,
				updatedBy: ids.owner,
			});
		}

		test("adding a mention then removing it leaves no row", async () => {
			await clearNotifications();
			await seedEntry();

			await updateMilestoneScopeEntry(
				tOwner(),
				ids.pMain,
				ids.mComment,
				entryId,
				{ body: mentionBody("Ping ", ids.dev, "Dev A") },
			);
			expect((await rowsFor(ids.dev)).length).toBe(1);

			await updateMilestoneScopeEntry(
				tOwner(),
				ids.pMain,
				ids.mComment,
				entryId,
				{ body: paragraph("No mention now") },
			);
			expect((await rowsFor(ids.dev)).length).toBe(0);
		});

		test("re-adding the same mention across edits keeps one row", async () => {
			await clearNotifications();
			await seedEntry();

			await updateMilestoneScopeEntry(
				tOwner(),
				ids.pMain,
				ids.mComment,
				entryId,
				{ body: mentionBody("Ping ", ids.dev, "Dev A") },
			);
			await updateMilestoneScopeEntry(
				tOwner(),
				ids.pMain,
				ids.mComment,
				entryId,
				{ body: paragraph("gone") },
			);
			await updateMilestoneScopeEntry(
				tOwner(),
				ids.pMain,
				ids.mComment,
				entryId,
				{ body: mentionBody("Ping again ", ids.dev, "Dev A") },
			);

			// The key no longer carries the edit timestamp, so the unique index
			// collapses the re-add into the same row.
			const rows = await rowsFor(ids.dev);
			expect(rows.length).toBe(1);
			expect(rows[0]?.dedupeKey).toBe(`mention:scope:${entryId}:${ids.dev}`);
		});

		test("removing one mention leaves the other recipient alone", async () => {
			await clearNotifications();
			await seedEntry();

			const both = [
				{
					type: "p",
					children: [
						{ text: "Both " },
						{
							type: "mention",
							key: `user:${ids.dev}`,
							value: "Dev A",
							children: [{ text: "" }],
						},
						{
							type: "mention",
							key: `user:${ids.client}`,
							value: "Client A",
							children: [{ text: "" }],
						},
					],
				},
			];

			await updateMilestoneScopeEntry(
				tOwner(),
				ids.pMain,
				ids.mComment,
				entryId,
				{ body: both },
			);

			expect((await rowsFor(ids.dev)).length).toBe(1);
			expect((await rowsFor(ids.client)).length).toBe(1);

			await updateMilestoneScopeEntry(
				tOwner(),
				ids.pMain,
				ids.mComment,
				entryId,
				{ body: mentionBody("Only ", ids.client, "Client A") },
			);

			expect((await rowsFor(ids.dev)).length).toBe(0);
			expect((await rowsFor(ids.client)).length).toBe(1);
		});
	});
});
