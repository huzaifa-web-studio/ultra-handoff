/**
 * Worker registry.
 *
 * Why: the API process owns a small set of background workers today. Keeping
 * the start and stop logic in one place means the entrypoint does not need to
 * know each queue, and adding another worker later is a one line change.
 *
 * Used by: src/index.ts.
 */

import { closeRedis } from "../lib/redis";
import { startEmailWorker, stopEmailWorker } from "../queues/email";
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
	startEmailWorker();
	startUploadVerificationWorker();

	return async () => {
		// Close the workers before the shared Redis client they depend on.
		await stopEmailWorker();
		await stopUploadVerification();
		await closeRedis();
	};
}
