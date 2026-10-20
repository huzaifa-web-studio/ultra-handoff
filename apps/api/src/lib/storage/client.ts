/**
 * SeaweedFS access through the AWS S3 SDK.
 *
 * This file is object storage, not authentication. It has nothing to do with
 * Better Auth. The browser auth client lives in
 * apps/web/src/features/auth/client.ts, and the server auth instance lives in
 * apps/api/src/auth/auth.ts.
 *
 * Two S3 clients are intentional:
 *
 * 1. `internalClient` talks to `S3_ENDPOINT` (the Docker service name). It is
 *    used for HEAD, ranged GET, delete and bucket setup, all of which happen
 *    server to server.
 * 2. `presignClient` points at `S3_PUBLIC_ENDPOINT` and is only used to create
 *    presigned URLs. "Signing" here means S3 SigV4 URL signing, not user
 *    sign-in. The URL is opened by the browser, and the host is part of the
 *    signature, so this endpoint must be publicly reachable.
 *
 * Used by: src/services/upload.service.ts, src/routes/files.ts and the upload
 * verification worker.
 */

import {
	CreateBucketCommand,
	DeleteObjectCommand,
	GetObjectCommand,
	HeadBucketCommand,
	HeadObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { s3Env } from "../env";

/** Shared connection settings for both clients. */
const baseConfig = {
	region: s3Env.region,
	// SeaweedFS uses path style addressing (`/bucket/key`), not virtual hosts.
	forcePathStyle: true,
	// Newer AWS SDK versions add a CRC32 checksum to presigned PUTs by
	// default. The checksum is computed over an empty body at signing time, so
	// SeaweedFS rejects the real upload with BadDigest. Only calculate a
	// checksum when an operation actually requires one.
	requestChecksumCalculation: "WHEN_REQUIRED" as const,
	responseChecksumValidation: "WHEN_REQUIRED" as const,
	credentials: {
		accessKeyId: s3Env.accessKey,
		secretAccessKey: s3Env.secretKey,
	},
};

const internalClient = new S3Client({
	...baseConfig,
	endpoint: s3Env.endpoint,
});

const presignClient = new S3Client({
	...baseConfig,
	endpoint: s3Env.publicEndpoint,
});

/**
 * Memoised bucket bootstrap.
 *
 * Why memoised: the first upload should not race two CreateBucket calls, and
 * every later upload should skip the extra round trip. A failure resets the
 * promise so the next request can retry instead of caching the error.
 */
let bucketReady: Promise<void> | null = null;

export function ensureBucket(): Promise<void> {
	if (!bucketReady) {
		bucketReady = createBucketIfMissing().catch((error) => {
			bucketReady = null;
			throw error;
		});
	}
	return bucketReady;
}

async function createBucketIfMissing(): Promise<void> {
	try {
		await internalClient.send(new HeadBucketCommand({ Bucket: s3Env.bucket }));
	} catch {
		// HeadBucket throws for a missing bucket and for a missing permission.
		// CreateBucket makes the missing bucket case succeed and surfaces the
		// permission case as a real error.
		await internalClient.send(
			new CreateBucketCommand({ Bucket: s3Env.bucket }),
		);
	}
}

/**
 * Create a short lived PUT URL for one object.
 *
 * `ContentType` is part of the signature on purpose. The browser must send
 * exactly this value, which stops a caller from uploading a different type
 * under a misleading extension. The worker still sniffs the bytes.
 */
export async function signPutUrl(
	key: string,
	contentType: string,
	expiresInSeconds = 300,
): Promise<string> {
	// The URL is opened by the browser. Signing with the internal Docker name
	// produces a URL nobody outside the compose network can resolve, which
	// surfaces as a generic network error in the upload UI. Refuse early and
	// point the operator at the missing setting instead.
	if (!s3Env.publicEndpoint) {
		throw new Error(
			"S3_PUBLIC_ENDPOINT is not set. Presigned uploads need a browser reachable storage URL.",
		);
	}

	await ensureBucket();

	const command = new PutObjectCommand({
		Bucket: s3Env.bucket,
		Key: key,
		ContentType: contentType,
	});

	return getSignedUrl(presignClient, command, {
		expiresIn: expiresInSeconds,
		// Without this the SDK signs only the host. Including content-type
		// binds the URL to one declared type, which the worker then re-checks
		// against the actual bytes.
		signableHeaders: new Set(["content-type"]),
	});
}

/** Read object metadata without downloading the body. */
export function headObject(key: string) {
	return internalClient.send(
		new HeadObjectCommand({ Bucket: s3Env.bucket, Key: key }),
	);
}

/**
 * Read the first few bytes of an object.
 *
 * Used by the worker for magic byte detection. A ranged GET keeps a rejected
 * 5 MB upload from being downloaded in full just to inspect its header.
 */
export async function readHeadBytes(
	key: string,
	length: number,
): Promise<Uint8Array> {
	const response = await internalClient.send(
		new GetObjectCommand({
			Bucket: s3Env.bucket,
			Key: key,
			Range: `bytes=0-${Math.max(length - 1, 0)}`,
		}),
	);

	if (!response.Body) {
		throw new Error("Storage returned an object without a body");
	}

	return response.Body.transformToByteArray();
}

/** Remove an object. Used for rejected uploads and replaced avatars. */
export async function deleteObject(key: string): Promise<void> {
	await internalClient.send(
		new DeleteObjectCommand({ Bucket: s3Env.bucket, Key: key }),
	);
}

/**
 * Open an object for streaming through the API.
 *
 * The API proxies reads so the bucket stays private. The returned stream is a
 * web stream, which can be handed straight to a `Response`.
 */
export async function openObject(key: string) {
	const response = await internalClient.send(
		new GetObjectCommand({ Bucket: s3Env.bucket, Key: key }),
	);

	if (!response.Body) {
		throw new Error("Storage returned an object without a body");
	}

	return {
		body: response.Body.transformToWebStream(),
		contentType: response.ContentType,
		contentLength: response.ContentLength,
		etag: response.ETag,
	};
}

/** Public, stable URL for a verified object. */
export function objectUrl(key: string): string {
	return `/files/${key}`;
}

/**
 * Extract the storage key from a `/files/...` URL.
 *
 * Returns null for external URLs (for example a Google avatar) so callers
 * never try to delete something we do not own.
 */
export function keyFromFileUrl(url: string): string | null {
	if (!url.startsWith("/files/")) return null;
	return url.slice("/files/".length);
}

/** Recognise the S3 "object does not exist" shape across SDK versions. */
export function isNotFoundError(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;

	const name = "name" in error ? String(error.name) : "";
	const status =
		"$metadata" in error
			? (error as { $metadata?: { httpStatusCode?: number } }).$metadata
					?.httpStatusCode
			: undefined;

	return (
		name === "NotFound" ||
		name === "NoSuchKey" ||
		name === "NoSuchBucket" ||
		status === 404
	);
}
