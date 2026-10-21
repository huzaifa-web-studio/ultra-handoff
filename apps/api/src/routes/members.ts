import { Elysia, t } from "elysia";

import {
	BULK_INVITE_MAX,
	BULK_SELECTION_MAX,
	canManageMembers,
} from "../auth/permissions";
import { authErrorMessage, authErrorStatus } from "../lib/auth-error";
import { tenantPlugin } from "../middleware/tenant";
import {
	bulkCancelInvitations,
	bulkInviteMembers,
	bulkResendInvitations,
	type InvitationHistoryQuery,
	type InvitationStatus,
	listInvitationHistory,
} from "../services/invitation.service";
import {
	bulkRemoveMembers,
	bulkUpdateMemberRole,
	listMembers,
	updateMemberRole,
} from "../services/member.service";

/**
 * Member and invitation management routes.
 *
 * Why routes instead of calling Better Auth from the browser: bulk invitations
 * and bulk removal are per item operations that must share permission guards,
 * seat checks and a partial failure result. The tenant macro has already
 * resolved `:orgSlug` to a workspace the caller belongs to, and the service
 * applies the role rules on top.
 *
 * Used by: src/index.ts.
 */

/**
 * Path params for a single member route.
 *
 * Both parameters must be declared. Elysia validates the whole params object
 * against this schema and treats an undeclared key as "Unexpected property",
 * so omitting `orgSlug` (which the tenant macro also reads) rejected every
 * single member request before the handler ran.
 */
const memberParams = t.Object({
	orgSlug: t.String({ minLength: 1, maxLength: 255 }),
	memberId: t.String({ minLength: 1, maxLength: 255 }),
});

const idList = t.Array(t.String({ minLength: 1, maxLength: 255 }), {
	minItems: 1,
	maxItems: BULK_SELECTION_MAX,
});

const invitationQuery = t.Object({
	status: t.Optional(t.String()),
	role: t.Optional(t.String()),
	search: t.Optional(t.String({ maxLength: 254 })),
	page: t.Optional(t.String()),
	pageSize: t.Optional(t.String()),
	sort: t.Optional(t.String()),
	direction: t.Optional(t.String()),
});

const HISTORY_STATUSES = [
	"all",
	"pending",
	"expired",
	"accepted",
	"canceled",
	"rejected",
] as const;

const HISTORY_SORTS = ["createdAt", "expiresAt", "email", "status"] as const;
const ROLE_FILTERS = ["all", "owner", "admin", "member"] as const;

/** Clamp query strings instead of trusting the browser. */
function parseInvitationQuery(query: {
	status?: string;
	role?: string;
	search?: string;
	page?: string;
	pageSize?: string;
	sort?: string;
	direction?: string;
}): InvitationHistoryQuery {
	const status = (HISTORY_STATUSES as readonly string[]).includes(
		query.status ?? "",
	)
		? (query.status as "all" | InvitationStatus)
		: "all";

	const role = (ROLE_FILTERS as readonly string[]).includes(query.role ?? "")
		? (query.role as InvitationHistoryQuery["role"])
		: "all";

	const sort = (HISTORY_SORTS as readonly string[]).includes(query.sort ?? "")
		? (query.sort as InvitationHistoryQuery["sort"])
		: "createdAt";

	const page = Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1);
	const pageSize = Math.min(
		100,
		Math.max(10, Number.parseInt(query.pageSize ?? "20", 10) || 20),
	);

	return {
		status,
		role,
		search: query.search ?? "",
		page,
		pageSize,
		sort,
		direction: query.direction === "asc" ? "asc" : "desc",
	};
}

export const memberRoutes = new Elysia({ name: "members" })
	.use(tenantPlugin)
	/**
	 * Everything the Members page renders in one request: rows, the caller's
	 * capabilities, seat limits, member counts and (for managers) the pending
	 * invitation count.
	 */
	.get(
		"/orgs/:orgSlug/members",
		async ({ tenant, request, status }) => {
			try {
				return await listMembers(tenant, request.headers);
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not load the members."),
				});
			}
		},
		{ tenant: true },
	)
	/** Single role change from the inline select. Owner promotion included. */
	.patch(
		"/orgs/:orgSlug/members/:memberId",
		async ({ tenant, request, status, params, body }) => {
			try {
				return await updateMemberRole(
					tenant,
					request.headers,
					params.memberId,
					body.role,
				);
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not change that role."),
				});
			}
		},
		{
			tenant: true,
			params: memberParams,
			body: t.Object({
				role: t.UnionEnum(["member", "admin", "owner"]),
			}),
		},
	)
	/** Bulk role change. Owner is intentionally not accepted here. */
	.post(
		"/orgs/:orgSlug/members/bulk-role",
		async ({ tenant, request, status, body }) => {
			try {
				return await bulkUpdateMemberRole(
					tenant,
					request.headers,
					body.memberIds,
					body.role,
				);
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not change those roles."),
				});
			}
		},
		{
			tenant: true,
			body: t.Object({
				memberIds: idList,
				role: t.UnionEnum(["member", "admin"]),
			}),
		},
	)
	/** Bulk removal. Self removal and the last owner are refused per item. */
	.post(
		"/orgs/:orgSlug/members/bulk-remove",
		async ({ tenant, request, status, body }) => {
			try {
				return await bulkRemoveMembers(tenant, request.headers, body.memberIds);
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not remove those members."),
				});
			}
		},
		{
			tenant: true,
			body: t.Object({ memberIds: idList }),
		},
	)
	/**
	 * Invitation history, pending and past, for owners and admins only.
	 *
	 * The role check lives here as well as in the service so a plain member
	 * gets a predictable 403 before any read happens.
	 */
	.get(
		"/orgs/:orgSlug/invitations",
		async ({ tenant, request, status, query }) => {
			if (!canManageMembers(tenant.role)) {
				return status(403, {
					message: "Only owners and admins can see invitations.",
				});
			}

			try {
				return await listInvitationHistory(
					tenant,
					request.headers,
					parseInvitationQuery(query),
				);
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not load the invitations."),
				});
			}
		},
		{ tenant: true, query: invitationQuery },
	)
	/** Invite up to 25 addresses with per address outcomes. */
	.post(
		"/orgs/:orgSlug/invitations/bulk",
		async ({ tenant, request, status, body }) => {
			try {
				return await bulkInviteMembers(
					tenant,
					request.headers,
					body.emails,
					body.role,
				);
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not send the invitations."),
				});
			}
		},
		{
			tenant: true,
			body: t.Object({
				emails: t.Array(t.String({ minLength: 3, maxLength: 254 }), {
					minItems: 1,
					maxItems: BULK_INVITE_MAX,
				}),
				role: t.UnionEnum(["member", "admin"]),
			}),
		},
	)
	/** Resend selected pending or expired invitations. */
	.post(
		"/orgs/:orgSlug/invitations/bulk-resend",
		async ({ tenant, request, status, body }) => {
			try {
				return await bulkResendInvitations(
					tenant,
					request.headers,
					body.invitationIds,
				);
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not resend the invitations."),
				});
			}
		},
		{
			tenant: true,
			body: t.Object({ invitationIds: idList }),
		},
	)
	/** Cancel selected pending or expired invitations. */
	.post(
		"/orgs/:orgSlug/invitations/bulk-cancel",
		async ({ tenant, request, status, body }) => {
			try {
				return await bulkCancelInvitations(
					tenant,
					request.headers,
					body.invitationIds,
				);
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not cancel the invitations."),
				});
			}
		},
		{
			tenant: true,
			body: t.Object({ invitationIds: idList }),
		},
	);
