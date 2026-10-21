/**
 * Organization routes that need to run inside the API.
 *
 * Why this file exists: name, slug and logo updates go straight through
 * Better Auth's client SDK, but removing a logo also has to delete the stored
 * object. Doing that from the browser would expose the storage key and skip
 * the role check, so the removal lives here behind the tenant macro.
 *
 * Used by: src/index.ts.
 */

import { Elysia } from "elysia";

import { auth } from "../auth/auth";
import { canEditOrganization, isOrganizationOwner } from "../auth/permissions";
import { tenantPlugin } from "../middleware/tenant";
import {
	getOrganizationLogo,
	getOrganizationSlug,
	resolveSignInOrganization,
} from "../services/organization.service";
import { deletePreviousOrgLogo } from "../services/upload.service";

export const organizationRoutes = new Elysia()
	.use(tenantPlugin)
	/**
	 * Clear the organization logo and delete the stored object.
	 *
	 * The tenant macro has already verified that the caller is a member of the
	 * organization in the URL. This adds the settings role rule (owner or
	 * admin) before any write happens.
	 */
	.delete(
		"/orgs/:orgSlug/logo",
		async ({ tenant, request, status }) => {
			if (!canEditOrganization(tenant.role)) {
				return status(403, {
					message: "You do not have permission to update this organization",
				});
			}

			// Capture the old URL first: Better Auth only returns the updated
			// row, and the object key is needed for cleanup.
			const previousLogo = await getOrganizationLogo(tenant.organizationId);

			try {
				await auth.api.updateOrganization({
					body: { data: { logo: null }, organizationId: tenant.organizationId },
					headers: request.headers,
				});
			} catch {
				return status(500, {
					message: "Could not remove the organization logo",
				});
			}

			await deletePreviousOrgLogo(tenant.organizationId, previousLogo);

			return { status: "ok" as const };
		},
		{ tenant: true },
	)
	/**
	 * Delete an organization and move the owner into their next workspace.
	 *
	 * Why a route instead of the client endpoint: deleting the organization
	 * also has to choose the next active organization. `resolveSignInOrganization`
	 * already owns that rule, and it can only run on the server.
	 *
	 * Only the owner can delete. Better Auth enforces the same permission, but
	 * the check here gives a clear response instead of a generic forbidden.
	 */
	.delete(
		"/orgs/:orgSlug",
		async ({ tenant, request, status }) => {
			if (!isOrganizationOwner(tenant.role)) {
				return status(403, {
					message: "Only the organization owner can delete it",
				});
			}

			try {
				await auth.api.deleteOrganization({
					body: { organizationId: tenant.organizationId },
					headers: request.headers,
				});
			} catch {
				return status(500, {
					message: "Could not delete the organization",
				});
			}

			// The deleted row clears user.lastActiveOrganizationId through its
			// `on delete set null` reference, so the helper falls back to the
			// earliest surviving membership. That is the next workspace the
			// user should land in.
			const nextOrganizationId = await resolveSignInOrganization(tenant.userId);
			const nextSlug = nextOrganizationId
				? await getOrganizationSlug(nextOrganizationId)
				: null;

			if (!nextOrganizationId || !nextSlug) {
				return {
					status: "ok" as const,
					nextOrganizationId: null,
					nextSlug: null,
				};
			}

			// Best effort: the client also sets the active organization so its
			// local store refreshes. A failure here must not fail the delete.
			try {
				await auth.api.setActiveOrganization({
					body: { organizationId: nextOrganizationId },
					headers: request.headers,
				});
			} catch {
				// The client can still select the workspace itself.
			}

			return { status: "ok" as const, nextOrganizationId, nextSlug };
		},
		{ tenant: true },
	);
