/**
 * Redis backed upload sessions.
 *
 * Why Redis instead of a table: an upload session is short lived coordination
 * state, not business data. The only thing that must survive is the final
 * `user.image` value, which Better Auth already stores. Keeping the session in
 * Redis avoids a migration and keeps RLS out of a purely infrastructural
 * concern.
 *
 * Used by: src/services/upload.service.ts, src/routes/uploads.ts and the
 * verification worker.
 */

import { randomUUID } from "node:crypto";

import { getRedis } from "../redis";
import { isUploadPurpose, type UploadPurpose } from "./config";

/** Sessions expire an hour after creation, plenty for a 5 MB upload. */
const SESSION_TTL_SECONDS = 60 * 60;

/** Maximum upload sessions a user may open in one window. */
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_SECONDS = 10 * 60;

export type UploadStatus = "pending" | "verifying" | "verified" | "rejected";

const UPLOAD_STATUSES: readonly UploadStatus[] = [
	"pending",
	"verifying",
	"verified",
	"rejected",
];

function isUploadStatus(value: unknown): value is UploadStatus {
	return (
		typeof value === "string" &&
		(UPLOAD_STATUSES as readonly string[]).includes(value)
	);
}

export type UploadSession = {
	id: string;
	userId: string;
	purpose: UploadPurpose;
	key: string;
	contentType: string;
	size: number;
	status: UploadStatus;
	/** Public URL, present only after verification. */
	url?: string;
	/** Human readable rejection reason, present only when rejected. */
	reason?: string;
	createdAt: number;
};

function sessionKey(id: string): string {
	return `upload:session:${id}`;
}

/** Generate an opaque upload id. Never reuse the client filename. */
export function newUploadId(): string {
	return randomUUID();
}

/** Persist a session with a rolling TTL. */
export async function saveUploadSession(session: UploadSession): Promise<void> {
	await getRedis().set(
		sessionKey(session.id),
		JSON.stringify(session),
		"EX",
		SESSION_TTL_SECONDS,
	);
}

/**
 * Read and validate a session.
 *
 * The shape check matters because Redis is outside TypeScript. A malformed
 * value must read as "no session" rather than crash the worker or the route.
 */
export async function getUploadSession(
	id: string,
): Promise<UploadSession | null> {
	const raw = await getRedis().get(sessionKey(id));
	if (!raw) return null;

	try {
		const value: unknown = JSON.parse(raw);
		if (!value || typeof value !== "object") return null;

		const record = value as Record<string, unknown>;
		if (
			typeof record.id !== "string" ||
			typeof record.userId !== "string" ||
			typeof record.key !== "string" ||
			typeof record.contentType !== "string" ||
			typeof record.size !== "number" ||
			typeof record.createdAt !== "number" ||
			typeof record.purpose !== "string" ||
			!isUploadPurpose(record.purpose) ||
			!isUploadStatus(record.status)
		) {
			return null;
		}

		return {
			id: record.id,
			userId: record.userId,
			purpose: record.purpose,
			key: record.key,
			contentType: record.contentType,
			size: record.size,
			status: record.status,
			url: typeof record.url === "string" ? record.url : undefined,
			reason: typeof record.reason === "string" ? record.reason : undefined,
			createdAt: record.createdAt,
		};
	} catch {
		return null;
	}
}

/** Merge a patch into a session, preserving its TTL. */
export async function updateUploadSession(
	id: string,
	patch: Partial<UploadSession>,
): Promise<UploadSession | null> {
	const current = await getUploadSession(id);
	if (!current) return null;

	const next = { ...current, ...patch };
	await saveUploadSession(next);
	return next;
}

/**
 * Count an upload attempt against the per user window.
 *
 * Returns false when the caller is over the limit. The counter is created
 * with an expiry on the first hit so it can never leak in Redis.
 */
export async function consumeUploadQuota(userId: string): Promise<boolean> {
	const redis = getRedis();
	const key = `upload:rate:${userId}`;

	const count = await redis.incr(key);
	if (count === 1) {
		await redis.expire(key, RATE_LIMIT_WINDOW_SECONDS);
	}

	return count <= RATE_LIMIT_MAX;
}
