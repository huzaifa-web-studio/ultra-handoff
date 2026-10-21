/**
 * Upload policy table for object storage.
 *
 * Why: every upload surface (avatars today, deliverables and attachments
 * later) must agree on the size limit, the allowed MIME types and the key
 * layout. Adding a purpose here is the only change required to support a new
 * kind of file, and the rest of the pipeline picks it up automatically.
 *
 * Used by: src/lib/storage/*, src/services/upload.service.ts, the verification
 * worker and the upload routes.
 */

/** Hard ceiling for avatars. Kept in bytes so comparisons stay exact. */
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

/** Organization logos share the image rules and the 5 MB ceiling. */
export const MAX_ORGANIZATION_LOGO_BYTES = 5 * 1024 * 1024;

/**
 * The set of purposes the API currently accepts.
 *
 * A purpose is not a free form string. It decides the validation rules, the
 * object key prefix and which post verification action runs.
 */
export const UPLOAD_PURPOSES = ["avatar", "organization-logo"] as const;

export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

/**
 * Who owns an uploaded object.
 *
 * Avatars belong to a user. Organization logos belong to a tenant and are
 * addressed by organization id, never by the slug, so a rename cannot orphan
 * an object.
 */
export type UploadScope = {
	userId: string;
	organizationId?: string;
};

export type UploadPolicy = {
	/** Largest accepted object in bytes. */
	maxBytes: number;
	/** MIME types the browser may declare and the worker will accept. */
	allowedMime: readonly string[];
	/** Whether the object is owned by a user or by an organization. */
	scopedTo: "user" | "organization";
	/** Build the object key prefix. Never trust a client path. */
	prefix: (scope: UploadScope) => string;
	/** Short text shown in the UI and reused in validation errors. */
	label: string;
};

/**
 * Build the prefix for an organization owned object.
 *
 * The organization id is required for this scope. Callers validate membership
 * before they get here, so a missing id is a programming error, not a user
 * mistake.
 */
function organizationScopePrefix(scope: UploadScope): string {
	if (!scope.organizationId) {
		throw new Error("An organization id is required for this upload purpose");
	}

	return `organizations/${scope.organizationId}`;
}

/**
 * Single source of truth for upload limits.
 *
 * Keys are generated from the policy, so a client can never choose a path or
 * write into another user's prefix.
 */
export const UPLOAD_POLICIES: Record<UploadPurpose, UploadPolicy> = {
	avatar: {
		maxBytes: MAX_AVATAR_BYTES,
		// SVG is deliberately excluded: it can carry script and would be
		// served from our own origin through /files.
		allowedMime: ["image/png", "image/jpeg"],
		scopedTo: "user",
		prefix: ({ userId }) => `avatars/${userId}`,
		label: "PNG or JPG up to 5 MB",
	},
	"organization-logo": {
		maxBytes: MAX_ORGANIZATION_LOGO_BYTES,
		allowedMime: ["image/png", "image/jpeg"],
		scopedTo: "organization",
		prefix: organizationScopePrefix,
		label: "PNG or JPG up to 5 MB",
	},
};

/** MIME types map to a fixed extension, never to the uploaded filename. */
const EXTENSIONS: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
};

/** Resolve the storage extension for a MIME type, or null if unsupported. */
export function extensionForMime(mime: string): string | null {
	return EXTENSIONS[mime] ?? null;
}

/**
 * Prefixes that may be served through the public /files route.
 *
 * Keeping an allowlist means a future private bucket (contracts, invoices)
 * cannot be exposed by accident just because a key exists.
 */
const PUBLIC_KEY_PREFIXES = ["avatars/", "organizations/"];

/** True when a key belongs to a publicly readable upload purpose. */
export function isPublicFileKey(key: string): boolean {
	return PUBLIC_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** Narrow an arbitrary string to a known upload purpose. */
export function isUploadPurpose(value: string): value is UploadPurpose {
	return (UPLOAD_PURPOSES as readonly string[]).includes(value);
}
