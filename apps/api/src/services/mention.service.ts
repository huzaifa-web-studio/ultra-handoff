/**
 * Mention business logic.
 *
 * Why a service instead of a few helpers in the comment service: a mention can
 * point at three different entities, and both the picker and the write path
 * have to agree on who may see each one. Keeping the search and the access
 * check together means a name offered by the picker is one the writer is
 * allowed to store, and a stored mention is one the reader can open.
 *
 * Rules:
 *   - people are always scoped to the current project, so a client cannot be
 *     @mentioned by somebody who only shares another project
 *   - projects and milestones follow the same visibility rule as the project
 *     list, including archived projects
 *   - Better Auth tables are read through `loadUserMap`, never joined into a
 *     tenant query
 *
 * Used by: src/routes/mentions.ts and src/services/comment.service.ts.
 */

import { APIError } from "better-auth/api";
import { and, asc, desc, eq, ilike, inArray } from "drizzle-orm";

import { milestone, project, projectMember } from "../db/schema";
import { type TenantTx, withTenant } from "../db/tenant";
import { collectMentionKeys } from "../lib/mentions";
import { escapeLike } from "../lib/query";
import type { TenantContext } from "../middleware/tenant";
import { listOrganizationOwners } from "./organization.service";
import {
	loadProjectAccess,
	projectVisibility,
	searchUserProfiles,
} from "./project.service";

/** One person the writer may mention. */
export type MentionPerson = {
	userId: string;
	name: string;
	image: string | null;
};

/** One project the writer may mention. */
export type MentionProject = {
	id: string;
	name: string;
	slug: string;
};

/** One milestone the writer may mention, with the project it belongs to. */
export type MentionMilestone = {
	id: string;
	title: string;
	projectId: string;
	projectName: string;
	projectSlug: string;
};

/** The grouped result the picker renders. */
export type MentionSearchResult = {
	users: MentionPerson[];
	projects: MentionProject[];
	milestones: MentionMilestone[];
	/** True when a group was cut at the limit, so the writer must narrow. */
	hasMore: {
		users: boolean;
		projects: boolean;
		milestones: boolean;
	};
};

/** Normalised search input, already clamped by the route. */
export type MentionSearchQuery = {
	search: string;
	limit: number;
};

/** Hard cap on results per group. */
export const MENTION_RESULT_MAX = 10;

/** Default results per group. */
const MENTION_RESULT_DEFAULT = 6;

/** Search text longer than this is ignored beyond the limit. */
const MENTION_SEARCH_MAX = 100;

/**
 * The error a stale or forged mention produces.
 *
 * Why one wording for all three types: the caller should not be able to probe
 * whether a hidden project or milestone exists by comparing messages.
 */
function invalidMentionError(): APIError {
	return new APIError("BAD_REQUEST", {
		message:
			"One of the mentions is no longer available. Remove it and try again.",
	});
}

/** Load the current project or answer 404 for a project the caller cannot see. */
async function requireSearchProject(
	tx: TenantTx,
	tenant: TenantContext,
	projectId: string,
): Promise<void> {
	const access = await loadProjectAccess(tx, tenant, projectId);

	if (!access) {
		throw new APIError("NOT_FOUND", {
			message: "That project no longer exists.",
		});
	}
}

/**
 * Search mention candidates for one comment.
 *
 * The three groups are read in one transaction so a project lookup cannot race
 * a membership change between two of the queries.
 */
export async function searchMentions(
	tenant: TenantContext,
	projectId: string,
	query: MentionSearchQuery,
): Promise<MentionSearchResult> {
	const limit = Math.min(
		MENTION_RESULT_MAX,
		Math.max(1, query.limit || MENTION_RESULT_DEFAULT),
	);
	const search = query.search.trim().slice(0, MENTION_SEARCH_MAX);
	const pattern = search.length > 0 ? `%${escapeLike(search)}%` : null;

	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			await requireSearchProject(tx, tenant, projectId);

			// People: read the project membership ids, add the organization owners
			// (they are always project owners), then search names in SQL on the
			// privileged client. Only `limit + 1` profiles ever leave Postgres,
			// instead of every member name on every keystroke.
			const memberRows = await tx
				.select({ userId: projectMember.userId })
				.from(projectMember)
				.where(
					and(
						eq(projectMember.organizationId, tenant.organizationId),
						eq(projectMember.projectId, projectId),
					),
				)
				.orderBy(asc(projectMember.userId));

			const owners = await listOrganizationOwners(tenant.organizationId);
			const candidateIds = [
				...new Set([
					...memberRows.map((row) => row.userId),
					...owners.map((owner) => owner.userId),
				]),
			];

			const userRows = await searchUserProfiles(
				candidateIds,
				search,
				limit + 1,
			);
			const userHasMore = userRows.length > limit;
			const users = userRows.slice(0, limit).map((person) => ({
				userId: person.id,
				name: person.name || person.email || "Former member",
				image: person.image,
			}));

			// Projects: the same visibility clause the project list uses. One extra
			// row only answers "was there more", and is never sent to the client.
			const projectRows = await tx
				.select({
					id: project.id,
					name: project.name,
					slug: project.slug,
				})
				.from(project)
				.where(
					and(
						eq(project.organizationId, tenant.organizationId),
						projectVisibility(tx, tenant),
						...(pattern ? [ilike(project.name, pattern)] : []),
					),
				)
				.orderBy(asc(project.name))
				.limit(limit + 1);

			const projectHasMore = projectRows.length > limit;

			// Milestones: every milestone whose project is visible. The join is
			// on business tables only, so no Better Auth row is pulled in.
			const milestoneRows = await tx
				.select({
					id: milestone.id,
					title: milestone.title,
					projectId: project.id,
					projectName: project.name,
					projectSlug: project.slug,
				})
				.from(milestone)
				.innerJoin(project, eq(milestone.projectId, project.id))
				.where(
					and(
						eq(milestone.organizationId, tenant.organizationId),
						projectVisibility(tx, tenant),
						...(pattern ? [ilike(milestone.title, pattern)] : []),
					),
				)
				.orderBy(desc(milestone.updatedAt))
				.limit(limit + 1);

			const milestoneHasMore = milestoneRows.length > limit;

			return {
				users,
				projects: projectRows.slice(0, limit),
				milestones: milestoneRows.slice(0, limit),
				hasMore: {
					users: userHasMore,
					projects: projectHasMore,
					milestones: milestoneHasMore,
				},
			};
		},
	);
}

/**
 * Check every mention in a comment body against the database.
 *
 * Called inside the write transaction, after the author permission checks, so a
 * crafted request cannot store a chip pointing at a project, milestone or person
 * the author cannot see. The sanitizer has already removed malformed keys, so
 * this only has to answer "does each target still exist and is it visible".
 */
export async function assertCommentMentions(
	tx: TenantTx,
	tenant: TenantContext,
	projectId: string,
	body: unknown[],
): Promise<void> {
	const mentions = collectMentionKeys(body);

	if (mentions.length === 0) return;

	const userIds = [
		...new Set(
			mentions.filter((mention) => mention.type === "user").map((m) => m.id),
		),
	];
	const projectIds = [
		...new Set(
			mentions.filter((mention) => mention.type === "project").map((m) => m.id),
		),
	];
	const milestoneIds = [
		...new Set(
			mentions
				.filter((mention) => mention.type === "milestone")
				.map((m) => m.id),
		),
	];

	if (userIds.length > 0) {
		const rows = await tx
			.select({ userId: projectMember.userId })
			.from(projectMember)
			.where(
				and(
					eq(projectMember.organizationId, tenant.organizationId),
					eq(projectMember.projectId, projectId),
					inArray(projectMember.userId, userIds),
				),
			);

		const members = new Set(rows.map((row) => row.userId));
		const missing = userIds.filter((id) => !members.has(id));

		// Organization owners are always project owners even if their membership
		// row failed to sync, so they are valid targets without a project row.
		if (missing.length > 0) {
			const owners = await listOrganizationOwners(tenant.organizationId);
			const ownerIds = new Set(owners.map((owner) => owner.userId));

			if (!missing.every((id) => ownerIds.has(id))) {
				throw invalidMentionError();
			}
		}
	}

	if (projectIds.length > 0) {
		const rows = await tx
			.select({ id: project.id })
			.from(project)
			.where(
				and(
					eq(project.organizationId, tenant.organizationId),
					inArray(project.id, projectIds),
					projectVisibility(tx, tenant),
				),
			);

		if (rows.length !== projectIds.length) throw invalidMentionError();
	}

	if (milestoneIds.length > 0) {
		const rows = await tx
			.select({ id: milestone.id })
			.from(milestone)
			.innerJoin(project, eq(milestone.projectId, project.id))
			.where(
				and(
					eq(milestone.organizationId, tenant.organizationId),
					inArray(milestone.id, milestoneIds),
					projectVisibility(tx, tenant),
				),
			);

		if (rows.length !== milestoneIds.length) throw invalidMentionError();
	}
}
