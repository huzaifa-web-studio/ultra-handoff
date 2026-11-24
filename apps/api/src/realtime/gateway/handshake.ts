/**
 * Realtime handshake and authorization.
 *
 * Why this file: the gateway authenticates before the upgrade and authorizes
 * the project or user topic before it subscribes. Those checks are the whole
 * security boundary of the socket, so they live together.
 *
 * Used by: `routes.ts` and `connection.ts`.
 */

import { withTenant } from "../../db/tenant";
import { serverEnv } from "../../lib/env";
import {
	resolveTenantScope,
	type TenantContext,
} from "../../middleware/tenant";
import { loadProjectAccess } from "../../services/project";
import type { RealtimeSocketHandle } from "../registry";

/** Close codes the client treats as terminal. */
export const CLOSE_UNAUTHENTICATED = 4401;
export const CLOSE_FORBIDDEN = 4403;
export const CLOSE_NOT_FOUND = 4404;
export const CLOSE_SERVER_ERROR = 1011;
export const CLOSE_RECONNECT = 1012;
export const CLOSE_GOING_AWAY = 1001;

/** The socket operations this file uses. Bun's socket satisfies the shape. */
export type GatewaySocket = RealtimeSocketHandle & {
	send(data: string): number;
	subscribe(topic: string): void;
	/** Elysia's per-socket state, which carries our auth and connection id. */
	data: unknown;
};

/** Result of authorising one upgrade attempt. */
export type RealtimeAuth =
	| {
			ok: true;
			scope: "project";
			projectId: string;
			tenant: TenantContext;
	  }
	| {
			ok: true;
			scope: "user";
			tenant: TenantContext;
	  }
	| { ok: false; code: number; reason: string };

/**
 * The object Bun keeps for the lifetime of one socket.
 *
 * Why this carries the auth result and the connection id: Elysia builds a new
 * `ElysiaWS` wrapper for every callback (`open`, `message`, `pong`, `close`), so
 * the wrapper cannot be used as an identity key. `ws.data` is the same object
 * for every callback, which makes it the only stable place to hang state.
 */
export type RealtimeSocketData = {
	realtimeAuth?: RealtimeAuth;
	realtimeConnectionId?: string;
};

/**
 * Resolve the tenant and the project access for one upgrade.
 *
 * Why `resolveTenantScope` directly instead of the `tenant` macro: macros are
 * an HTTP route feature, and a WebSocket upgrade is an HTTP GET with params.
 * Calling the same resolver keeps one membership rule for both surfaces.
 */
export async function resolveRealtimeTenant(
	request: Request,
	orgSlug: string,
): Promise<
	| { ok: true; tenant: TenantContext }
	| { ok: false; code: number; reason: string }
> {
	try {
		// A WebSocket upgrade is not covered by CORS. A hostile page cannot read
		// the stream, but it can still open it with the visitor's cookies if the
		// cookie policy allows that. Comparing Origin against the same web origin
		// the CORS config trusts closes that gap. A missing Origin is accepted:
		// only a non browser client omits it, and it still has to hold a session.
		const origin = request.headers.get("origin");
		const allowedOrigin = serverEnv.webUrl.replace(/\/$/, "");

		if (origin && origin !== allowedOrigin) {
			return { ok: false, code: CLOSE_FORBIDDEN, reason: "origin not allowed" };
		}

		const resolution = await resolveTenantScope(request.headers, orgSlug);

		if (resolution.kind === "unauthenticated") {
			return {
				ok: false,
				code: CLOSE_UNAUTHENTICATED,
				reason: "unauthenticated",
			};
		}

		// An unconfirmed account may not stream workspace data. Forbidden is
		// terminal in the browser policy, so the client stops rather than
		// retrying with the same unproven session.
		if (resolution.kind === "unverified") {
			return {
				ok: false,
				code: CLOSE_FORBIDDEN,
				reason: "email not verified",
			};
		}

		if (resolution.kind === "not-found") {
			return { ok: false, code: CLOSE_FORBIDDEN, reason: "forbidden" };
		}

		return {
			ok: true,
			tenant: resolution.tenant,
		};
	} catch {
		// A database failure is transient. 1011 tells the client to retry.
		return { ok: false, code: CLOSE_SERVER_ERROR, reason: "server error" };
	}
}

/** Authorise one project socket, including that project's access rule. */
export async function authorizeProject(
	request: Request,
	orgSlug: string,
	projectId: string,
): Promise<RealtimeAuth> {
	const resolved = await resolveRealtimeTenant(request, orgSlug);

	if (!resolved.ok) return resolved;

	try {
		const tenant = resolved.tenant;
		const access = await withTenant(
			{ organizationId: tenant.organizationId, userId: tenant.userId },
			(tx) => loadProjectAccess(tx, tenant, projectId),
		);

		// A project the caller cannot see answers "not found", matching the
		// milestone endpoints, so the stream cannot confirm a project exists.
		if (!access) {
			return { ok: false, code: CLOSE_NOT_FOUND, reason: "not found" };
		}

		return {
			ok: true,
			scope: "project",
			projectId,
			tenant,
		};
	} catch {
		return { ok: false, code: CLOSE_SERVER_ERROR, reason: "server error" };
	}
}

/**
 * Authorise one personal socket.
 *
 * No project check is needed because the socket only receives the caller's own
 * notifications for this workspace. The tenant resolver has already proved the
 * membership and the verified address.
 */
export async function authorizeUser(
	request: Request,
	orgSlug: string,
): Promise<RealtimeAuth> {
	const resolved = await resolveRealtimeTenant(request, orgSlug);

	if (!resolved.ok) return resolved;

	return { ok: true, scope: "user", tenant: resolved.tenant };
}
