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
	listObjectKeys,
	objectUrl,
	openObject,
	putObject,
	readHeadBytes,
	type StoredObject,
	signPutUrl,
} from "./client";
export {
	extensionForMime,
	type FileKeyAccess,
	fileKeyAccess,
	isPublicFileKey,
	isUploadPurpose,
	MAX_ATTACHMENT_BYTES,
	MAX_AVATAR_BYTES,
	MAX_COMMENT_IMAGE_BYTES,
	MAX_MILESTONE_IMAGE_BYTES,
	MAX_ORGANIZATION_LOGO_BYTES,
	MAX_PROJECT_LOGO_BYTES,
	UPLOAD_POLICIES,
	UPLOAD_PURPOSES,
	type UploadPolicy,
	type UploadPurpose,
	type UploadScope,
} from "./config";
export { type DetectedImageType, sniffImageType } from "./image";
export { keyFromRichText, safeDownloadName } from "./keys";
export {
	consumeUploadQuota,
	getUploadSession,
	newUploadId,
	saveUploadSession,
	type UploadSession,
	type UploadStatus,
	updateUploadSession,
} from "./session";
