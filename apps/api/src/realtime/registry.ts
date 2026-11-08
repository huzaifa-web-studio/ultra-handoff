/**
 * Realtime connection registry.
 *
 * Why this exists: Bun owns the sockets and the topic fan-out, but it does not
 * answer the questions the server needs answered per connection (who is this,
 * which project, have they gone quiet, which milestone are they looking at).
 * This registry is that index.
 *
 * Why a class with a factory: the singleton is convenient in the gateway, but
 * tests must start from an empty registry. A new instance per test avoids
 * order dependent failures.
 *
 * Milestone subscriptions are tracked here in phase 0 even though only
 * presence uses them later. They are the expensive half of presence (cleanup
 * on disconnect, per milestone lookup), so building them now avoids rework.
 *
 * Used by: realtime/gateway.ts and realtime/index.ts.
 */

/** The socket operations the registry needs. Bun's socket satisfies this. */
export type RealtimeSocketHandle = {
	ping(): void;
	close(code?: number, reason?: string): void;
	terminate(): void;
};

/** One live connection. */
export type RealtimeConnection = {
	/** Opaque id, unique per socket, not the user id. */
	id: string;
	userId: string;
	organizationId: string;
	projectId: string;
	connectedAt: number;
	/** Last time any frame arrived from this client. */
	lastSeenAt: number;
	/** Last protocol level pong. Drives the dead socket sweep. */
	lastPongAt: number;
	/** Milestones this socket joined for presence. */
	milestones: Set<string>;
	/** Inbound frame window, used by the rate limit. */
	windowStartedAt: number;
	windowFrames: number;
	socket: RealtimeSocketHandle;
};

/** Key for the per milestone index. */
function milestoneKey(projectId: string, milestoneId: string): string {
	return `${projectId}:${milestoneId}`;
}

/**
 * Close code used when a membership change revokes a connection.
 *
 * 4403 matches the forbidden code the upgrade already uses, so the browser
 * policy treats a revocation as terminal instead of reconnecting into a wall.
 */
export const REALTIME_CLOSE_REVOKED = 4403;

export class RealtimeRegistry {
	private readonly byId = new Map<string, RealtimeConnection>();
	private readonly byProject = new Map<string, Set<string>>();
	private readonly byMilestone = new Map<string, Set<string>>();

	/** Register a live connection and index it. */
	add(connection: RealtimeConnection): void {
		this.byId.set(connection.id, connection);

		const project = this.byProject.get(connection.projectId) ?? new Set();
		project.add(connection.id);
		this.byProject.set(connection.projectId, project);
	}

	/**
	 * Remove a connection and every index entry it owns.
	 *
	 * Called from both the close handler and the heartbeat sweep, so it must be
	 * safe to call twice for the same id.
	 */
	remove(id: string): void {
		const connection = this.byId.get(id);
		if (!connection) return;

		this.byId.delete(id);

		const project = this.byProject.get(connection.projectId);
		if (project) {
			project.delete(id);

			if (project.size === 0) this.byProject.delete(connection.projectId);
		}

		for (const milestoneId of connection.milestones) {
			const key = milestoneKey(connection.projectId, milestoneId);
			const members = this.byMilestone.get(key);

			if (!members) continue;

			members.delete(id);

			if (members.size === 0) this.byMilestone.delete(key);
		}

		connection.milestones.clear();
	}

	/** Look up a connection by its id, or null when it already left. */
	get(id: string): RealtimeConnection | null {
		return this.byId.get(id) ?? null;
	}

	/**
	 * Remove and close every connection the predicate accepts.
	 *
	 * Why on the registry: a membership change is not tied to one socket, and
	 * the registry is the only place holding every socket handle. Closing from
	 * here keeps the transport detail out of the services that revoke access.
	 *
	 * Iterates over a snapshot so `remove` can mutate the map safely, and the
	 * close failure path mirrors `retire` in the gateway.
	 */
	retireWhere(
		predicate: (connection: RealtimeConnection) => boolean,
		code: number,
		reason: string,
	): number {
		let retired = 0;

		for (const connection of [...this.byId.values()]) {
			if (!predicate(connection)) continue;

			this.remove(connection.id);

			try {
				connection.socket.close(code, reason);
			} catch {
				try {
					connection.socket.terminate();
				} catch {
					// Already gone. Nothing left to clean up.
				}
			}

			retired += 1;
		}

		return retired;
	}

	/** Every live connection, newest state included. */
	all(): IterableIterator<RealtimeConnection> {
		return this.byId.values();
	}

	/** Connections currently attached to one project. */
	projectConnections(projectId: string): RealtimeConnection[] {
		const ids = this.byProject.get(projectId);

		if (!ids) return [];

		const result: RealtimeConnection[] = [];

		for (const id of ids) {
			const connection = this.byId.get(id);

			if (connection) result.push(connection);
		}

		return result;
	}

	/** Join the presence group for one milestone. Idempotent. */
	subscribeMilestone(connectionId: string, milestoneId: string): boolean {
		const connection = this.byId.get(connectionId);

		if (!connection) return false;

		connection.milestones.add(milestoneId);

		const key = milestoneKey(connection.projectId, milestoneId);
		const members = this.byMilestone.get(key) ?? new Set();
		members.add(connectionId);
		this.byMilestone.set(key, members);

		return true;
	}

	/** Leave the presence group for one milestone. Idempotent. */
	unsubscribeMilestone(connectionId: string, milestoneId: string): boolean {
		const connection = this.byId.get(connectionId);

		if (!connection) return false;

		connection.milestones.delete(milestoneId);

		const key = milestoneKey(connection.projectId, milestoneId);
		const members = this.byMilestone.get(key);

		if (members) {
			members.delete(connectionId);

			if (members.size === 0) this.byMilestone.delete(key);
		}

		return true;
	}

	/** Everyone currently looking at one milestone. */
	milestoneConnections(
		projectId: string,
		milestoneId: string,
	): RealtimeConnection[] {
		const ids = this.byMilestone.get(milestoneKey(projectId, milestoneId));

		if (!ids) return [];

		const result: RealtimeConnection[] = [];

		for (const id of ids) {
			const connection = this.byId.get(id);

			if (connection) result.push(connection);
		}

		return result;
	}

	/** Record a protocol level pong. */
	touchPong(id: string, at = Date.now()): void {
		const connection = this.byId.get(id);

		if (!connection) return;

		connection.lastPongAt = at;
		connection.lastSeenAt = at;
	}

	/** Record an inbound frame that is not a pong. */
	touchSeen(id: string, at = Date.now()): void {
		const connection = this.byId.get(id);

		if (!connection) return;

		connection.lastSeenAt = at;
	}

	/**
	 * Count one inbound frame against the per second budget.
	 *
	 * Why a fixed window per connection: the budget is a guard against a broken
	 * client, not a product quota. A one second window is cheap, has no shared
	 * state and cannot affect another socket.
	 */
	consumeFrame(id: string, limit: number, at = Date.now()): boolean {
		const connection = this.byId.get(id);

		if (!connection) return false;

		if (at - connection.windowStartedAt >= 1000) {
			connection.windowStartedAt = at;
			connection.windowFrames = 0;
		}

		connection.windowFrames += 1;

		return connection.windowFrames <= limit;
	}

	/** Live connection count, used by tests and the sweep. */
	get size(): number {
		return this.byId.size;
	}

	/** Drop everything. Tests only. */
	clear(): void {
		this.byId.clear();
		this.byProject.clear();
		this.byMilestone.clear();
	}
}

/** Build an empty registry. */
export function createRealtimeRegistry(): RealtimeRegistry {
	return new RealtimeRegistry();
}

/** The process wide registry the gateway uses. */
export const realtimeRegistry = createRealtimeRegistry();
