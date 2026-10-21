/**
 * Organization switch safety.
 *
 * Why this exists: Better Auth stores the active organization on the shared
 * session, not per tab. A long operation in one tab can be interrupted when
 * the same user switches organization in another tab. This module records
 * long running operations in localStorage so any tab can check, at the moment
 * of a switch, whether leaving the current workspace is safe.
 *
 * Rules:
 *   - One key per operation, never one shared registry key. Two tabs starting
 *     at the same time must not overwrite each other.
 *   - Every entry has an expiry and a heartbeat. A crashed or closed tab stops
 *     heartbeating, so the entry ages out instead of blocking forever.
 *   - The block is scoped to the organization that owns the operation. An
 *     operation in Acme never blocks switching between Beta and Gamma.
 *   - Only leaving the busy organization is blocked. Entering a busy workspace
 *     from another one is not dangerous for the operation itself.
 *
 * Scope: browser local. Another device or browser profile does not see this
 * registry. Long work that must survive that needs a server side job. The
 * guard is a UX safety layer, not the data correctness mechanism. Every write
 * must still pass an explicit organization id.
 *
 * Required usage: wrap every long running organization operation.
 *
 *   const operation = beginOrganizationOperation({
 *     organizationId,
 *     organizationSlug,
 *     reason: "Sending invitations to 12 people",
 *   });
 *   try {
 *     await doWork();
 *   } finally {
 *     operation.end();
 *   }
 *
 * Used by: useSwitchOrganization, the leave card, the delete card and the logo
 * uploader. The future Members page must use the same wrapper for bulk invites.
 */

/** Prefix for one localStorage entry per operation. */
const STORAGE_PREFIX = "handoff:org-operation:";

/** Default lifetime. The heartbeat refreshes it while the operation is alive. */
const DEFAULT_TTL_MS = 2 * 60 * 1000;

/** Refresh interval, capped so a long TTL does not write too often. */
const HEARTBEAT_MS = 30 * 1000;

/** Stable identity for this tab. Useful when inspecting the registry. */
const tabId = createId();

/** A long running operation recorded for switch safety. */
export type OrganizationOperation = {
	id: string;
	organizationId: string;
	organizationSlug: string;
	/** User facing reason shown in the blocked dialog. */
	reason: string;
	tabId: string;
	startedAt: number;
	expiresAt: number;
};

/** Returned by `beginOrganizationOperation`. Always call `end` in a finally. */
export type OrganizationOperationHandle = {
	id: string;
	/** Rewrite the expiry now. The heartbeat also calls this. */
	extend: () => void;
	/** Remove the entry and stop the heartbeat. */
	end: () => void;
};

/** Why a switch is currently unsafe. */
export type SwitchBlock = {
	operationId: string;
	reason: string;
	organizationSlug: string;
};

function createId(): string {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID();
	}

	return `op-${Math.random().toString(36).slice(2)}`;
}

function storageKey(id: string): string {
	return `${STORAGE_PREFIX}${id}`;
}

function isOrganizationOperation(
	value: unknown,
): value is OrganizationOperation {
	if (!value || typeof value !== "object") return false;

	const record = value as Record<string, unknown>;

	return (
		typeof record.id === "string" &&
		typeof record.organizationId === "string" &&
		typeof record.organizationSlug === "string" &&
		typeof record.reason === "string" &&
		typeof record.tabId === "string" &&
		typeof record.startedAt === "number" &&
		typeof record.expiresAt === "number"
	);
}

/**
 * Read every live operation and delete the expired ones.
 *
 * Pruning on read is enough: a stale entry from a crashed tab is removed the
 * next time any tab checks whether a switch is safe.
 */
export function readOrganizationOperations(): OrganizationOperation[] {
	if (typeof window === "undefined") return [];

	const now = Date.now();
	const live: OrganizationOperation[] = [];
	const expiredKeys: string[] = [];

	try {
		const storage = window.localStorage;

		// Snapshot the keys first. Another tab can add or remove entries while
		// this loop runs, and a live length in the condition would skip keys.
		const keys: string[] = [];
		for (let index = 0; index < storage.length; index += 1) {
			const key = storage.key(index);
			if (key?.startsWith(STORAGE_PREFIX)) keys.push(key);
		}

		for (const key of keys) {
			const raw = storage.getItem(key);
			if (!raw) continue;

			let value: unknown;
			try {
				value = JSON.parse(raw);
			} catch {
				expiredKeys.push(key);
				continue;
			}

			if (!isOrganizationOperation(value) || value.expiresAt <= now) {
				expiredKeys.push(key);
				continue;
			}

			live.push(value);
		}

		for (const key of expiredKeys) {
			storage.removeItem(key);
		}
	} catch {
		// Private mode or storage disabled. The guard cannot see other tabs,
		// so it simply reports no block instead of breaking the switch.
		return [];
	}

	return live;
}

/**
 * Start recording an organization operation.
 *
 * The heartbeat keeps the entry alive for the lifetime of the operation. The
 * caller must call `end` in a `finally` block so a successful or failed
 * operation clears the block immediately.
 */
export function beginOrganizationOperation(input: {
	organizationId: string;
	organizationSlug: string;
	reason: string;
	ttlMs?: number;
}): OrganizationOperationHandle {
	const id = createId();
	const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
	const startedAt = Date.now();

	if (typeof window === "undefined") {
		return {
			id,
			extend: () => undefined,
			end: () => undefined,
		};
	}

	const write = () => {
		const entry: OrganizationOperation = {
			id,
			organizationId: input.organizationId,
			organizationSlug: input.organizationSlug,
			reason: input.reason,
			tabId,
			startedAt,
			expiresAt: Date.now() + ttlMs,
		};

		try {
			window.localStorage.setItem(storageKey(id), JSON.stringify(entry));
		} catch {
			// Storage is unavailable. The operation still runs, it just cannot
			// participate in the cross-tab guard.
		}
	};

	write();

	const heartbeat = window.setInterval(
		write,
		Math.max(1000, Math.min(HEARTBEAT_MS, Math.floor(ttlMs / 3))),
	);

	return {
		id,
		extend: write,
		end: () => {
			window.clearInterval(heartbeat);
			try {
				window.localStorage.removeItem(storageKey(id));
			} catch {
				// Nothing to clean up when storage is unavailable.
			}
		},
	};
}

/**
 * The operation currently blocking a workspace, or null.
 *
 * Multiple operations on the same organization are combined into one reason
 * so the dialog never hides work behind the first entry.
 */
export function getBlockingOperation(
	organizationId: string | null | undefined,
): SwitchBlock | null {
	if (!organizationId) return null;

	const operations = readOrganizationOperations()
		.filter((operation) => operation.organizationId === organizationId)
		.sort((left, right) => left.startedAt - right.startedAt);

	const first = operations[0];
	if (!first) return null;

	const extra = operations.length - 1;
	const reason =
		extra > 0
			? `${first.reason} (and ${extra} more operation${extra === 1 ? "" : "s"})`
			: first.reason;

	return {
		operationId: first.id,
		reason,
		organizationSlug: first.organizationSlug,
	};
}

/**
 * Why switching from one organization to another is unsafe, or null.
 *
 * Staying in the same organization is always allowed. Only leaving a
 * workspace with a live operation is blocked.
 */
export function getSwitchBlock(
	currentOrganizationId: string | null | undefined,
	targetOrganizationId: string | null | undefined,
): SwitchBlock | null {
	if (!currentOrganizationId) return null;
	if (currentOrganizationId === targetOrganizationId) return null;

	return getBlockingOperation(currentOrganizationId);
}
