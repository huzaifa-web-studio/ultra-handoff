/**
 * Public surface of the storage module.
 *
 * Why: routes, services and the worker should import from one place instead of
 * reaching into individual files. That keeps the internal layout free to move.
 *
 * Used by: src/services/upload.service.ts, src/routes/files.ts and the upload
 * verification worker.
 */

export {
	deleteObject,
	ensureBucket,
	headObject,
	isNotFoundError,
	keyFromFileUrl,
	objectUrl,
	openObject,
	readHeadBytes,
	signPutUrl,
} from "./client";
export {
	extensionForMime,
	isPublicFileKey,
	isUploadPurpose,
	MAX_AVATAR_BYTES,
	UPLOAD_POLICIES,
	UPLOAD_PURPOSES,
	type UploadPolicy,
	type UploadPurpose,
} from "./config";
export { type DetectedImageType, sniffImageType } from "./image";
export {
	consumeUploadQuota,
	getUploadSession,
	newUploadId,
	saveUploadSession,
	type UploadSession,
	type UploadStatus,
	updateUploadSession,
} from "./session";
