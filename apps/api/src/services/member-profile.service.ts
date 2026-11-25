/**
 * Member profiles.
 *
 * Why a service of its own: a profile is the one read that joins Better Auth's
 * people data with business data (project membership and milestone
 * assignments). It has to apply the same visibility rules as the project list
 * and the milestone list, so the hover card and the profile page can never show
 * a project the viewer is not allowed to open.
 *
 * Reads of `user` and `member` go through the privileged client, the same
 * pattern as `services/organization.service.ts`. Everything tenant scoped runs
 * inside `withTenant`, so RLS enforces the workspace boundary a second time.
 *
 * Used by: `src/routes/people.ts`.
 */

import { APIError } from "better-auth/api";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
	ACTIVE_MILESTONE_STATUSES,
	type MilestoneStatus,
} from "../auth/milestone-permissions";
import { isOrganizationOwner } from "../auth/permissions";
import type { ProjectRole } from "../auth/project-permissions";
import { adminDb } from "../db";
import { member, user } from "../db/auth-schema";
import {
	milestone,
	milestoneAssignee,
	project,
	projectMember,
} from "../db/schema";
import { withTenant } from "../db/tenant";
import type { TenantContext } from "../middleware/tenant";
import { projectVisibility } from "./project";

/** One project the profile owner belongs to, as the viewer may see it. */
export type MemberProfileProject = {
	id: string;
	name: string;
	slug: string;
	logo: string | null;
	role: ProjectRole;
	archived: boolean;
};

/** One open milestone assigned to the profile owner. */
export type MemberProfileAssignment = {
	id: string;
	title: string;
	status: MilestoneStatus;
	/** `YYYY-MM-DD` from the date column, or null when no due date is set. */
	dueDate: string | null;
	projectId: string;
	projectName: string;
	projectSlug: string;
};

/** Everything the hover card and the profile page render. */
export type MemberProfile = {
	userId: string;
	name: string;
	email: string;
	image: string | null;
	jobTitle: string | null;
	bio: string | null;
	location: string | null;
	/** Raw organization role, which may hold several comma separated roles. */
	role: string;
	joinedAt: string;
	isSelf: boolean;
	projects: MemberProfileProject[];
	assignments: MemberProfileAssignment[];
	counts: { projects: number; assignments: number };
};

/**
 * Most open assignments one profile returns.
 *
 * A profile is a summary, not a work queue. The cap keeps the payload small for
 * a busy person and is generous enough that the page rarely cuts a real list.
 */
const ASSIGNMENT_LIMIT = 50;

/** The person's own fields plus their membership in this workspace. */
type ProfileIdentity = {
	userId: string;
	name: string;
	email: string;
	image: string | null;
	jobTitle: string | null;
	bio: string | null;
	location: string | null;
	role: string;
	joinedAt: Date;
};

/**
 * Read the profile owner and prove they still belong to this workspace.
 *
 * A user who left, was removed, or never joined is indistinguishable from a
 * missing id on purpose, so the endpoint cannot be used to probe for accounts.
 */
async function loadProfileIdentity(
	tenant: TenantContext,
	userId: string,
): Promise<ProfileIdentity | null> {
	const [row] = await adminDb
		.select({
			userId: user.id,
			name: user.name,
			email: user.email,
			image: user.image,
			jobTitle: user.jobTitle,
			bio: user.bio,
			location: user.location,
			role: member.role,
			joinedAt: member.createdAt,
		})
		.from(member)
		.innerJoin(user, eq(member.userId, user.id))
		.where(
			and(
				eq(member.organizationId, tenant.organizationId),
				eq(member.userId, userId),
			),
		)
		.limit(1);

	return row ?? null;
}

/** Active projects first, then alphabetical. Small lists, so sort in memory. */
function sortProjects(
	projects: MemberProfileProject[],
): MemberProfileProject[] {
	return [...projects].sort((left, right) => {
		if (left.archived !== right.archived) return left.archived ? 1 : -1;

		return left.name.localeCompare(right.name);
	});
}

/**
 * Build one member's profile for the current viewer.
 *
 * Project access is filtered with `projectVisibility`, so the list matches what
 * the viewer could open in the sidebar. Assignments are limited to active
 * projects and live statuses, because finished work is not what someone checks
 * a profile for.
 */
export async function getMemberProfile(
	tenant: TenantContext,
	targetUserId: string,
): Promise<MemberProfile> {
	const identity = await loadProfileIdentity(tenant, targetUserId);

	if (!identity) {
		throw new APIError("NOT_FOUND", {
			message: "That person is not part of this workspace.",
		});
	}

	const projectMap = new Map<string, MemberProfileProject>();

	const assignments = await withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			// Explicit project memberships. Organization owners are handled
			// below, because they own every project without needing a row.
			const rows = await tx
				.select({
					id: project.id,
					name: project.name,
					slug: project.slug,
					logo: project.logo,
					role: projectMember.role,
					archivedAt: project.archivedAt,
				})
				.from(projectMember)
				.innerJoin(project, eq(projectMember.projectId, project.id))
				.where(
					and(
						eq(projectMember.organizationId, tenant.organizationId),
						eq(projectMember.userId, targetUserId),
						projectVisibility(tx, tenant),
					),
				);

			for (const row of rows) {
				projectMap.set(row.id, {
					id: row.id,
					name: row.name,
					slug: row.slug,
					logo: row.logo,
					role: row.role as ProjectRole,
					archived: row.archivedAt !== null,
				});
			}

			// An organization owner is an owner of every project, whether or not
			// the materialized membership row exists. Merge the implicit view
			// without overwriting a real project role.
			if (isOrganizationOwner(identity.role)) {
				const visible = await tx
					.select({
						id: project.id,
						name: project.name,
						slug: project.slug,
						logo: project.logo,
						archivedAt: project.archivedAt,
					})
					.from(project)
					.where(
						and(
							eq(project.organizationId, tenant.organizationId),
							projectVisibility(tx, tenant),
						),
					);

				for (const row of visible) {
					projectMap.set(row.id, {
						id: row.id,
						name: row.name,
						slug: row.slug,
						logo: row.logo,
						role: "owner",
						archived: row.archivedAt !== null,
					});
				}
			}

			const assignmentRows = await tx
				.select({
					id: milestone.id,
					title: milestone.title,
					status: milestone.status,
					dueDate: milestone.dueDate,
					projectId: project.id,
					projectName: project.name,
					projectSlug: project.slug,
				})
				.from(milestoneAssignee)
				.innerJoin(
					projectMember,
					eq(milestoneAssignee.projectMemberId, projectMember.id),
				)
				.innerJoin(milestone, eq(milestoneAssignee.milestoneId, milestone.id))
				.innerJoin(project, eq(milestone.projectId, project.id))
				.where(
					and(
						eq(milestoneAssignee.organizationId, tenant.organizationId),
						eq(projectMember.userId, targetUserId),
						inArray(milestone.status, [...ACTIVE_MILESTONE_STATUSES]),
						// Archived projects are read only, so their open items are
						// history rather than current work.
						isNull(project.archivedAt),
						projectVisibility(tx, tenant),
					),
				)
				.orderBy(asc(milestone.dueDate), asc(milestone.title))
				.limit(ASSIGNMENT_LIMIT);

			return assignmentRows.map((row) => ({
				id: row.id,
				title: row.title,
				status: row.status as MilestoneStatus,
				dueDate: row.dueDate,
				projectId: row.projectId,
				projectName: row.projectName,
				projectSlug: row.projectSlug,
			}));
		},
	);

	const projects = sortProjects([...projectMap.values()]);

	return {
		userId: identity.userId,
		name: identity.name || identity.email,
		email: identity.email,
		image: identity.image,
		jobTitle: identity.jobTitle,
		bio: identity.bio,
		location: identity.location,
		role: identity.role,
		joinedAt: identity.joinedAt.toISOString(),
		isSelf: identity.userId === tenant.userId,
		projects,
		assignments,
		counts: {
			projects: projects.length,
			assignments: assignments.length,
		},
	};
}
