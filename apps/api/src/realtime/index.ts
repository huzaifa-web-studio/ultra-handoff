/**
 * Realtime lifecycle.
 *
 * Why a small barrel instead of wiring three modules in the entrypoint: the
 * entrypoint should only say "start realtime on this server" and "stop it on
 * shutdown". The order inside (publisher, then bus, then heartbeat) is a
 * detail of this module.
 *
 * Used by: src/index.ts.
 */

import {
	publishRealtimeEvent,
	setRealtimeLocalPublisher,
	startRealtimeBus,
	stopRealtimeBus,
} from "./bus";
import { startRealtimeHeartbeat, stopRealtimeHeartbeat } from "./gateway";

/** The only server capability realtime needs from Bun. */
type RealtimeServer = {
	publish(topic: string, data: string): number;
};

/**
 * Attach realtime to a listening server.
 *
 * Must run after `listen`, because the Bun server does not exist before that.
 * Returns the shutdown function the entrypoint calls before the shared Redis
 * client is closed.
 */
export function startRealtime(server: RealtimeServer): () => void {
	// Bun's topic registry is per process, so the local hop is this function.
	// Redis still carries every event, which is what makes a second replica
	// work without a second code path.
	setRealtimeLocalPublisher((topic, payload) => {
		server.publish(topic, payload);
	});

	startRealtimeBus();
	startRealtimeHeartbeat();

	return () => {
		stopRealtimeHeartbeat();
		stopRealtimeBus();
	};
}

export { publishRealtimeEvent };
export type { RealtimeEnvelope, RealtimeEventType } from "./protocol";
