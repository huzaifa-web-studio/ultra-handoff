/**
 * Worker registry.
 *
 * Why: the API process owns a small set of background workers today. Keeping
 * the start and stop logic in one place means the entrypoint does not need to
 * know each queue, and adding a second worker later is a one line change.
 *
 * Used by: src/index.ts.
 */

import { closeRedis } from "../lib/redis";
import {
	startUploadVerificationWorker,
	stopUploadVerification,
} from "../queues/upload-verification";

/**
 * Start every worker and return a shutdown function.
 *
 * The workers run in the API process on purpose. It keeps deployment to a
 * single container while the queue contract stays the same, so moving them to
 * a dedicated container later does not require touching the routes.
 */
export function startWorkers(): () => Promise<void> {
	startUploadVerificationWorker();

	return async () => {
		await stopUploadVerification();
		// The upload session client is separate from BullMQ's connections.
		await closeRedis();
	};
}
