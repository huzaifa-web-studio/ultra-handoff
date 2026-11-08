/**
 * Remove object storage keys that no business row references.
 *
 * Why this exists: attachments live only as `/files/<key>` URLs inside
 * `milestone.description` and `comment.body`. A delete path removes the
 * objects it can see, but a crashed request, an older release or a manual
 * database change can still leave bytes behind. This pass is the safety net.
 *
 * Scope is deliberately narrow. Only keys under a project, milestone or
 * comment folder are considered. Avatars and organization logos are skipped,
 * because their references live in Better Auth tables and this script must not
 * read those tables to decide what to delete.
 *
 * Safety:
 *   - dry run by default, `--apply` is required to delete anything
 *   - objects younger than the grace window are skipped, so an upload that has
 *     not been attached yet is never treated as orphaned
 *   - the referenced set is read from the database, never from the bucket
 *
 * Run with:
 *   cd apps/api && bun run db:reconcile-objects
 *   cd apps/api && bun run db:reconcile-objects --apply
 *
 * Used by: operators. Not part of the application runtime.
 */

import { adminClient, adminDb } from "../src/db";
import { comment, milestone, project } from "../src/db/schema";
import {
	deleteObject,
	keyFromRichText,
	listObjectKeys,
} from "../src/lib/storage";

/** An object is only a candidate once it is older than this. */
const GRACE_MS = 24 * 60 * 60 * 1000;

/** Folders this pass is allowed to prune. */
const MANAGED_MARKERS = ["/projects/", "/milestones/", "/comments/"];

const apply = process.argv.includes("--apply");

/**
 * Keys under a folder this script is allowed to prune.
 *
 * Kept as an explicit marker check rather than an allowlist of purposes so a
 * new attachment folder only needs its marker added here, and any folder that
 * is not listed is left untouched.
 */
function isManagedKey(key: string): boolean {
	if (!key.startsWith("organizations/")) return false;

	return MANAGED_MARKERS.some((marker) => key.includes(marker));
}

/** Build the set of keys a live business row still points at. */
async function collectReferencedKeys(): Promise<Set<string>> {
	const referenced = new Set<string>();

	const projects = await adminDb
		.select({ logo: project.logo })
		.from(project);

	for (const row of projects) {
		for (const key of keyFromRichText(row.logo)) referenced.add(key);
	}

	const milestones = await adminDb
		.select({ description: milestone.description })
		.from(milestone);

	for (const row of milestones) {
		for (const key of keyFromRichText(row.description)) referenced.add(key);
	}

	const comments = await adminDb.select({ body: comment.body }).from(comment);

	for (const row of comments) {
		for (const key of keyFromRichText(row.body)) referenced.add(key);
	}

	return referenced;
}

async function main(): Promise<void> {
	console.info(
		apply
			? "Reconciliation starting in APPLY mode. Orphaned objects will be deleted."
			: "Reconciliation starting in dry run mode. Pass --apply to delete.",
	);

	const [objects, referenced] = await Promise.all([
		listObjectKeys(),
		collectReferencedKeys(),
	]);

	const cutoff = Date.now() - GRACE_MS;
	const orphaned = objects.filter((object) => {
		if (!isManagedKey(object.key)) return false;
		if (referenced.has(object.key)) return false;

		// An object with no timestamp is treated as recent, which keeps the
		// pass conservative when storage metadata is incomplete.
		if (!object.lastModified) return false;

		return object.lastModified.getTime() < cutoff;
	});

	console.info(
		`Scanned ${objects.length} objects. ${referenced.size} keys are referenced. ${orphaned.length} look orphaned.`,
	);

	for (const object of orphaned.slice(0, 50)) {
		console.info(`  ${object.key} (${object.size} bytes)`);
	}

	if (orphaned.length > 50) {
		console.info(`  ...and ${orphaned.length - 50} more.`);
	}

	if (!apply) {
		console.info("Dry run complete. No objects were deleted.");
		return;
	}

	let deleted = 0;

	for (const object of orphaned) {
		try {
			await deleteObject(object.key);
			deleted += 1;
		} catch (error) {
			console.error(
				`Could not delete ${object.key}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	console.info(`Deleted ${deleted} of ${orphaned.length} orphaned objects.`);
}

try {
	await main();
} catch (error) {
	console.error(
		`Reconciliation failed: ${error instanceof Error ? error.message : String(error)}`,
	);
	process.exitCode = 1;
} finally {
	await adminClient.end({ timeout: 5 });
}
