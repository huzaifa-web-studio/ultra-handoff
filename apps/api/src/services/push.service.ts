/**
 * Web Push subscriptions and delivery.
 *
 * Why a table and a worker: a closed tab has no socket, so the browser push
 * service is the only delivery path. The subscription is a personal device
 * token, protected by the user-only RLS policy, and the worker owns the retry
 * and cleanup policy for dead endpoints.
 *
 * The payload is already rendered by the notification writer, so this module
 * never reads another person's notification row under RLS.
 *
 * Used by: routes/push.ts, queues/push.ts and the notifications page.
 */

import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { sendNotification, setVapidDetails } from "web-push";

import { pushSubscription } from "../db/schema";
import { withUser } from "../db/tenant";
import { pushEnabled, pushEnv } from "../lib/env";

/** At most this many devices per person. The oldest is pruned past it. */
const MAX_SUBSCRIPTIONS = 10;

/** Delete a subscription after this many consecutive failed sends. */
const MAX_FAILURES = 5;

/** Longest endpoint and key strings a push service can produce. */
const ENDPOINT_MAX = 2_000;
const KEY_MAX = 500;

/** One stored subscription, in the shape web-push expects. */
export type PushTarget = {
	id: string;
	endpoint: string;
	p256dh: string;
	auth: string;
};

/** The data the browser needs to render an alert. */
export type PushPayload = {
	title: string;
	body: string;
	href: string;
	tag: string;
	/**
	 * The workspace that produced the alert.
	 *
	 * The service worker uses it to suppress an alert only when a visible window
	 * is showing that same workspace. A window on another workspace has not
	 * shown this event, so suppressing there lost the alert entirely.
	 */
	organizationSlug: string;
};

/** Public config, safe to send to the browser. */
export function getPushConfig(): { enabled: boolean; publicKey: string } {
	return {
		enabled: pushEnabled,
		publicKey: pushEnabled ? pushEnv.publicKey : "",
	};
}

/** Configure web-push once, when the deployment has keys. */
let configured = false;

function ensureConfigured(): boolean {
	if (!pushEnabled) return false;
	if (configured) return true;

	setVapidDetails(pushEnv.subject, pushEnv.publicKey, pushEnv.privateKey);
	configured = true;

	return true;
}

/** Validate and store one browser subscription. */
export async function savePushSubscription(
	userId: string,
	input: {
		endpoint: unknown;
		p256dh: unknown;
		auth: unknown;
		userAgent?: unknown;
	},
): Promise<{ status: "ok" }> {
	const endpoint = typeof input.endpoint === "string" ? input.endpoint : "";
	const p256dh = typeof input.p256dh === "string" ? input.p256dh : "";
	const auth = typeof input.auth === "string" ? input.auth : "";
	const userAgent =
		typeof input.userAgent === "string" ? input.userAgent.slice(0, 400) : null;

	if (
		endpoint.length === 0 ||
		endpoint.length > ENDPOINT_MAX ||
		!endpoint.startsWith("https://") ||
		p256dh.length === 0 ||
		p256dh.length > KEY_MAX ||
		auth.length === 0 ||
		auth.length > KEY_MAX
	) {
		throw new Error("Invalid push subscription");
	}

	await withUser(userId, async (tx) => {
		// Allow this transaction to claim the endpoint from a previous account
		// on the same browser. The claim policy only matches this exact URL.
		await tx.execute(
			sql`select set_config('app.push_endpoint', ${endpoint}, true)`,
		);

		// One endpoint belongs to one browser. Signing in as a different person
		// reassigns it, which is what stops the previous person's alerts on a
		// shared device.
		await tx
			.insert(pushSubscription)
			.values({ id: randomUUID(), userId, endpoint, p256dh, auth, userAgent })
			.onConflictDoUpdate({
				target: pushSubscription.endpoint,
				set: {
					userId,
					p256dh,
					auth,
					userAgent,
					failureCount: 0,
					updatedAt: new Date(),
				},
			});

		const rows = await tx
			.select({ id: pushSubscription.id })
			.from(pushSubscription)
			.where(eq(pushSubscription.userId, userId))
			.orderBy(asc(pushSubscription.createdAt));

		const excess = rows.length - MAX_SUBSCRIPTIONS;

		if (excess > 0) {
			const oldIds = rows.slice(0, excess).map((row) => row.id);

			for (const id of oldIds) {
				await tx.delete(pushSubscription).where(eq(pushSubscription.id, id));
			}
		}
	});

	return { status: "ok" };
}

/** Remove one browser subscription. */
export async function removePushSubscription(
	userId: string,
	endpoint: string,
): Promise<{ status: "ok" }> {
	await withUser(userId, async (tx) => {
		await tx
			.delete(pushSubscription)
			.where(
				and(
					eq(pushSubscription.userId, userId),
					eq(pushSubscription.endpoint, endpoint),
				),
			);
	});

	return { status: "ok" };
}

/** Read one person's subscriptions. */
async function loadPushTargets(userId: string): Promise<PushTarget[]> {
	return withUser(userId, (tx) =>
		tx
			.select({
				id: pushSubscription.id,
				endpoint: pushSubscription.endpoint,
				p256dh: pushSubscription.p256dh,
				auth: pushSubscription.auth,
			})
			.from(pushSubscription)
			.where(eq(pushSubscription.userId, userId)),
	);
}

/** Delete an endpoint the push service has rejected for good. */
async function dropTarget(userId: string, endpoint: string): Promise<void> {
	await withUser(userId, (tx) =>
		tx
			.delete(pushSubscription)
			.where(
				and(
					eq(pushSubscription.userId, userId),
					eq(pushSubscription.endpoint, endpoint),
				),
			),
	);
}

/** Count one transient failure and drop the row at the limit. */
async function recordFailure(userId: string, targetId: string): Promise<void> {
	await withUser(userId, async (tx) => {
		const [row] = await tx
			.update(pushSubscription)
			.set({ failureCount: sql`${pushSubscription.failureCount} + 1` })
			.where(eq(pushSubscription.id, targetId))
			.returning({ failureCount: pushSubscription.failureCount });

		if (row && row.failureCount >= MAX_FAILURES) {
			await tx
				.delete(pushSubscription)
				.where(eq(pushSubscription.id, targetId));
		}
	});
}

/** Record a successful send. */
async function recordSuccess(userId: string, targetId: string): Promise<void> {
	await withUser(userId, (tx) =>
		tx
			.update(pushSubscription)
			.set({ failureCount: 0, lastUsedAt: new Date() })
			.where(eq(pushSubscription.id, targetId)),
	);
}

/** Read the HTTP status from a web-push error. */
function pushStatus(error: unknown): number | null {
	if (!error || typeof error !== "object") return null;

	const status = (error as { statusCode?: unknown }).statusCode;

	return typeof status === "number" ? status : null;
}

/**
 * Send one rendered notification to every subscribed browser of one person.
 *
 * 404 and 410 mean the subscription is gone for good and are deleted at once.
 * Every other failure is counted, and five consecutive failures remove the
 * row. Nothing here throws into the queue's success path: a dead endpoint is
 * not a reason to retry the whole notification forever.
 */
export async function sendPushToUser(
	userId: string,
	payload: PushPayload,
): Promise<void> {
	if (!ensureConfigured()) return;

	const targets = await loadPushTargets(userId);

	if (targets.length === 0) return;

	const body = JSON.stringify(payload);

	for (const target of targets) {
		try {
			await sendNotification(
				{
					endpoint: target.endpoint,
					keys: { p256dh: target.p256dh, auth: target.auth },
				},
				body,
				{ TTL: 60 * 60, urgency: "normal" },
			);

			await recordSuccess(userId, target.id);
		} catch (error) {
			const status = pushStatus(error);

			if (status === 404 || status === 410) {
				await dropTarget(userId, target.endpoint);
				continue;
			}

			await recordFailure(userId, target.id);
		}
	}
}
