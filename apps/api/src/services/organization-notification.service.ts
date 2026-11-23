/**
 * Organization level notifications raised from Better Auth hooks.
 *
 * Why a separate module: Better Auth owns the invitation acceptance and role
 * update paths, so the only place to observe them is a hook. Keeping the
 * database write and the realtime dispatch here means `auth.ts` stays a
 * configuration file instead of growing transaction code.
 *
 * Every function is best effort. A lost notification must never fail an
 * invitation acceptance or a role change, which are the user's real action.
 *
 * Used by: src/auth/auth.ts (organizationHooks).
 */

import { withTenant } from "../db/tenant";
import {
	createNotifications,
	type NotificationDelivery,
} from "./notification.service";
import { dispatchNotificationDeliveries } from "./notification-dispatch.service";

/** The organization fields the copy and the tenant scope need. */
type OrganizationRef = {
	id: string;
	name: string;
	slug: string;
};

/**
 * Tell the inviter that their invitation was accepted.
 *
 * The accepting user is the actor. The row belongs to the inviter, which is why
 * the transaction is scoped to the inviter rather than to the new member.
 */
export async function notifyInvitationAccepted(input: {
	organization: OrganizationRef;
	inviterId: string;
	memberId: string;
	memberUserId: string;
}): Promise<void> {
	try {
		const deliveries = await withTenant(
			{
				organizationId: input.organization.id,
				userId: input.inviterId,
			},
			(tx) =>
				createNotifications(
					tx,
					{
						organizationId: input.organization.id,
						slug: input.organization.slug,
					},
					[
						{
							recipientUserId: input.inviterId,
							actorUserId: input.memberUserId,
							type: "member_joined",
							dedupeKey: `member_joined:${input.memberId}`,
							organizationName: input.organization.name,
							data: { organizationName: input.organization.name },
						},
					],
				),
		);

		dispatchNotificationDeliveries(deliveries);
	} catch {
		// A notification failure is not an invitation failure.
	}
}

/**
 * Tell a member that their organization role changed.
 *
 * Better Auth's hook does not pass the acting administrator, so the row has no
 * actor and the copy is neutral. The previous and next roles are stored in
 * `data`, because the organization table is a Better Auth table and must not be
 * joined into a tenant read later.
 */
export async function notifyOrganizationRoleChanged(input: {
	organization: OrganizationRef;
	memberId: string;
	userId: string;
	previousRole: string | null;
	newRole: string;
}): Promise<void> {
	if (input.previousRole === input.newRole) return;

	try {
		const deliveries = await withTenant(
			{
				organizationId: input.organization.id,
				userId: input.userId,
			},
			(tx) =>
				createNotifications(
					tx,
					{
						organizationId: input.organization.id,
						slug: input.organization.slug,
					},
					[
						{
							recipientUserId: input.userId,
							actorUserId: null,
							type: "org_role_changed",
							dedupeKey: `org_role:${input.memberId}:${input.previousRole ?? "none"}:${input.newRole}`,
							organizationName: input.organization.name,
							data: {
								from: input.previousRole ?? "none",
								to: input.newRole,
								organizationName: input.organization.name,
							},
						},
					],
				),
		);

		dispatchNotificationDeliveries(deliveries);
	} catch {
		// A notification failure is not a role change failure.
	}
}

/** Re-exported so the hook signature can name the delivery type if needed. */
export type { NotificationDelivery };
