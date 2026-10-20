/**
 * Generic presigned upload client.
 *
 * Why one helper: avatars are the first upload surface, but deliverables and
 * attachments will reuse the same three steps. Keeping create, PUT and verify
 * here means no feature reimplements the storage protocol.
 *
 * Flow:
 *   1. POST /uploads -> short lived presigned PUT URL
 *   2. PUT the file straight to SeaweedFS (never through the API)
 *   3. POST /uploads/:id/complete -> worker verifies the object
 *
 * The limits below mirror the API policy for instant feedback. The API and the
 * worker are still authoritative and re-check everything.
 *
 * Used by: src/features/account/avatar-uploader.tsx and future upload UIs.
 */

import { api, readApiError } from "./api";

export type UploadPurpose = "avatar";

export type FilePolicy = {
	maxBytes: number;
	mime: readonly string[];
	/** Value for the file input `accept` attribute. */
	accept: string;
	/** Short text shown next to the picker. */
	label: string;
};

export const FILE_POLICIES: Record<UploadPurpose, FilePolicy> = {
	avatar: {
		maxBytes: 5 * 1024 * 1024,
		mime: ["image/png", "image/jpeg"],
		accept: "image/png,image/jpeg",
		label: "PNG or JPG up to 5 MB",
	},
};

export type UploadedFile = {
	id: string;
	url: string;
};

export type UploadFileOptions = {
	file: File;
	purpose: UploadPurpose;
	onProgress?: (percent: number) => void;
	signal?: AbortSignal;
};

/**
 * Validate a file before any network call.
 *
 * Returns a user facing message, or null when the file is acceptable. The MIME
 * type can be empty on some systems, so the extension is used as a fallback.
 */
export function validateUploadFile(
	file: File,
	purpose: UploadPurpose,
): string | null {
	const policy = FILE_POLICIES[purpose];
	const mime = normalizeMime(file);

	if (!mime || !policy.mime.includes(mime)) {
		return "Only PNG and JPG images are allowed.";
	}

	if (file.size <= 0) {
		return "The selected file is empty.";
	}

	if (file.size > policy.maxBytes) {
		return `The image must be 5 MB or smaller.`;
	}

	return null;
}

function normalizeMime(file: File): string | null {
	if (file.type) {
		// Some platforms add parameters such as `; charset=binary`.
		return file.type.split(";")[0]?.trim().toLowerCase() ?? null;
	}

	const name = file.name.toLowerCase();
	if (name.endsWith(".png")) return "image/png";
	if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";

	return null;
}

/**
 * Upload a file and resolve once the worker has verified it.
 *
 * Throws a plain `Error` with a message the caller can render. An aborted
 * upload throws a `DOMException` named "AbortError", which callers can ignore.
 */
export async function uploadFile({
	file,
	purpose,
	onProgress,
	signal,
}: UploadFileOptions): Promise<UploadedFile> {
	const problem = validateUploadFile(file, purpose);
	if (problem) throw new Error(problem);

	const mime = normalizeMime(file);
	if (!mime) throw new Error("Only PNG and JPG images are allowed.");

	const created = await api.uploads.post({
		purpose,
		contentType: mime,
		size: file.size,
	});

	if (created.error || !created.data) {
		throw new Error(
			readApiError(created.error, "Could not prepare the upload."),
		);
	}

	// Use the Content-Type returned by the API. It is part of the signature,
	// so sending the browser's value could produce a signature mismatch.
	await putToStorage(
		created.data.uploadUrl,
		file,
		created.data.contentType,
		onProgress,
		signal,
	);

	return completeUpload(created.data.id);
}

/**
 * Ask the API to verify, polling while a job is still running.
 *
 * The first call usually returns verified immediately because the route waits
 * briefly for the worker. Polling only happens when storage is slow.
 */
async function completeUpload(id: string): Promise<UploadedFile> {
	for (let attempt = 0; attempt < 12; attempt += 1) {
		const result = await api.uploads({ id }).complete.post();

		if (result.error) {
			throw new Error(
				readApiError(result.error, "Could not verify the upload."),
			);
		}

		if (result.data?.status === "verified" && result.data.url) {
			return { id, url: result.data.url };
		}

		await sleep(500);
	}

	throw new Error(
		"Verification is taking longer than expected. Please try again.",
	);
}

/** PUT the bytes with progress and abort support. */
function putToStorage(
	url: string,
	file: File,
	contentType: string,
	onProgress?: (percent: number) => void,
	signal?: AbortSignal,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const request = new XMLHttpRequest();

		request.open("PUT", url);
		request.setRequestHeader("Content-Type", contentType);

		request.upload.onprogress = (event) => {
			if (event.lengthComputable && onProgress) {
				onProgress(Math.round((event.loaded / event.total) * 100));
			}
		};

		request.onload = () => {
			if (request.status >= 200 && request.status < 300) {
				onProgress?.(100);
				resolve();
				return;
			}

			reject(new Error("The upload failed. Please try again."));
		};

		request.onerror = () => {
			reject(new Error("Could not reach the storage service."));
		};

		request.onabort = () => {
			reject(new DOMException("Upload cancelled", "AbortError"));
		};

		if (signal) {
			if (signal.aborted) {
				request.abort();
				return;
			}

			signal.addEventListener("abort", () => request.abort(), {
				once: true,
			});
		}

		request.send(file);
	});
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
