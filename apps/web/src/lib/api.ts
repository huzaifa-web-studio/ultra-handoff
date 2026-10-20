import { treaty } from "@elysia/eden";
import type { App } from "@org/api";

/**
 * Eden Treaty client for the Handoff API.
 * All typed API calls (e.g. /uploads, /account) go through this client.
 * Auth endpoints (/api/auth/*) are mounted by Better Auth and are called
 * directly through `authClient`.
 */
const API_BASE = (
	import.meta.env.VITE_API_URL || "http://localhost:3001"
).replace(/\/$/, "");

/**
 * `credentials: "include"` is required because the web app and the API run on
 * different ports in development and on different subdomains in production.
 * Without it the browser drops the session cookie and every protected route
 * answers 401.
 */
export const api = treaty<App>(API_BASE, {
	fetch: { credentials: "include" },
});

/** Base URL used when resolving API served assets such as `/files/...`. */
export const API_ORIGIN = API_BASE;

/**
 * Turn an Eden error or a plain error into a message safe to show in the UI.
 *
 * Eden wraps API bodies in `{ value }` and different routes use `message` or
 * `reason`, so this helper centralises the shape handling instead of repeating
 * it in every feature.
 */
export function readApiError(error: unknown, fallback: string): string {
	if (!error || typeof error !== "object") return fallback;

	if ("value" in error) {
		const message = readMessage((error as { value?: unknown }).value);
		if (message) return message;
	}

	return readMessage(error) ?? fallback;
}

function readMessage(value: unknown): string | null {
	if (!value || typeof value !== "object") return null;

	if ("message" in value) {
		const message = (value as { message?: unknown }).message;
		if (typeof message === "string" && message.length > 0) return message;
	}

	if ("reason" in value) {
		const reason = (value as { reason?: unknown }).reason;
		if (typeof reason === "string" && reason.length > 0) return reason;
	}

	return null;
}
