import { treaty } from "@elysia/eden";
import type { App } from "@org/api";

/**
 * Eden Treaty client for the Handoff API.
 * All typed API calls (e.g. /me, /users) go through this client.
 * Auth endpoints (/api/auth/*) are mounted by Better Auth and are called
 * directly via fetch against the API base URL.
 */
const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";

export const api = treaty<App>(API_BASE);
