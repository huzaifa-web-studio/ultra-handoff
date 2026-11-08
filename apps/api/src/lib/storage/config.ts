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

/** Project logos use the same image rules and ceiling as organization logos. */
export const MAX_PROJECT_LOGO_BYTES = 5 * 1024 * 1024;

/** Images embedded in a milestone description use the same image rules. */
export const MAX_MILESTONE_IMAGE_BYTES = 5 * 1024 * 1024;

/** Images embedded in a comment use the same image rules. */
export const MAX_COMMENT_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Documents attached to a comment or a milestone description.
 *
 * Larger than an image because a brief, a deck or a zip of assets is a normal
 * thing to hand over in a discussion. Still bounded, so one message cannot park
 * an unbounded object in storage.
 */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/**
 * The set of purposes the API currently accepts.
 *
 * A purpose is not a free form string. It decides the validation rules, the
 * object key prefix and which post verification action runs.
 */
export const UPLOAD_PURPOSES = [
	"avatar",
	"organization-logo",
	"project-logo",
	"milestone-image",
	"milestone-file",
	"comment-image",
	"comment-file",
] as const;

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
	/**
	 * Whether the bytes must be a real image.
	 *
	 * Image purposes are byte sniffed, because a mislabelled image is served
	 * from our own origin. Document purposes are checked by declared MIME and
	 * size only; the allowlist excludes HTML and SVG, which is what keeps the
	 * public `/files` route safe.
	 */
	kind: "image" | "file";
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
 * Documents that a discussion or a milestone description may carry.
 *
 * No HTML and no SVG: both can execute script from our own origin. Everything
 * here is either rendered by a fixed viewer or downloaded.
 */
const DOCUMENT_MIME = [
	"application/pdf",
	"text/plain",
	"text/csv",
	"application/msword",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	"application/vnd.ms-excel",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	"application/vnd.ms-powerpoint",
	"application/vnd.openxmlformats-officedocument.presentationml.presentation",
	"application/zip",
] as const;

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
		kind: "image",
		scopedTo: "user",
		prefix: ({ userId }) => `avatars/${userId}`,
		label: "PNG or JPG up to 5 MB",
	},
	"organization-logo": {
		maxBytes: MAX_ORGANIZATION_LOGO_BYTES,
		allowedMime: ["image/png", "image/jpeg"],
		kind: "image",
		scopedTo: "organization",
		prefix: organizationScopePrefix,
		label: "PNG or JPG up to 5 MB",
	},
	"project-logo": {
		maxBytes: MAX_PROJECT_LOGO_BYTES,
		allowedMime: ["image/png", "image/jpeg"],
		kind: "image",
		scopedTo: "organization",
		// Separate from the organization logo so project images can be found
		// and cleaned up without touching the logo object.
		prefix: (scope) => `${organizationScopePrefix(scope)}/projects`,
		label: "PNG or JPG up to 5 MB",
	},
	"milestone-image": {
		maxBytes: MAX_MILESTONE_IMAGE_BYTES,
		allowedMime: ["image/png", "image/jpeg"],
		kind: "image",
		scopedTo: "organization",
		// One folder per tenant, separate from logos, so an image that is no
		// longer referenced by any milestone can be found by prefix later.
		prefix: (scope) => `${organizationScopePrefix(scope)}/milestones`,
		label: "PNG or JPG up to 5 MB",
	},
	"milestone-file": {
		maxBytes: MAX_ATTACHMENT_BYTES,
		allowedMime: DOCUMENT_MIME,
		kind: "file",
		scopedTo: "organization",
		// A nested folder keeps attachments from being mistaken for milestone
		// images when either set is cleaned up later.
		prefix: (scope) => `${organizationScopePrefix(scope)}/milestones/files`,
		label: "PDF, Office, text or ZIP up to 10 MB",
	},
	"comment-image": {
		maxBytes: MAX_COMMENT_IMAGE_BYTES,
		allowedMime: ["image/png", "image/jpeg"],
		kind: "image",
		scopedTo: "organization",
		// Its own folder, so a discussion attachment can never be confused
		// with a project or milestone image during a future cleanup pass.
		prefix: (scope) => `${organizationScopePrefix(scope)}/comments/images`,
		label: "PNG or JPG up to 5 MB",
	},
	"comment-file": {
		maxBytes: MAX_ATTACHMENT_BYTES,
		allowedMime: DOCUMENT_MIME,
		kind: "file",
		scopedTo: "organization",
		prefix: (scope) => `${organizationScopePrefix(scope)}/comments/files`,
		label: "PDF, Office, text or ZIP up to 10 MB",
	},
};

/** MIME types map to a fixed extension, never to the uploaded filename. */
const EXTENSIONS: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"application/pdf": "pdf",
	"text/plain": "txt",
	"text/csv": "csv",
	"application/msword": "doc",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document":
		"docx",
	"application/vnd.ms-excel": "xls",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
	"application/vnd.ms-powerpoint": "ppt",
	"application/vnd.openxmlformats-officedocument.presentationml.presentation":
		"pptx",
	"application/zip": "zip",
};

/** Resolve the storage extension for a MIME type, or null if unsupported. */
export function extensionForMime(mime: string): string | null {
	return EXTENSIONS[mime] ?? null;
}

/**
 * Who may read a stored object.
 *
 * Why a classifier instead of a public/private prefix list: the same
 * `organizations/<orgId>/` prefix now holds both public branding (the
 * organization logo and project logos) and private client material (milestone
 * and comment attachments). A prefix allowlist cannot separate the two, so the
 * decision is made per key shape instead.
 */
export type FileKeyAccess =
	| { visibility: "public" }
	| { visibility: "organization"; organizationId: string };

/**
 * Better Auth organization ids are opaque text. Restricting the shape here
 * stops a crafted key from smuggling a path segment into the membership
 * lookup.
 */
const ORGANIZATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Folders inside an organization that are never public. */
const PRIVATE_ORGANIZATION_FOLDERS = new Set(["comments", "milestones"]);

/**
 * Decide what a stored key is allowed to do.
 *
 * Shapes:
 *   avatars/<userId>/<file>                 public
 *   organizations/<orgId>/<file>            public, this is the org logo
 *   organizations/<orgId>/projects/...      public, project logos
 *   organizations/<orgId>/comments/...      organization members only
 *   organizations/<orgId>/milestones/...    organization members only
 *
 * Anything else is denied. Default deny is what keeps a future private bucket
 * (contracts, invoices) from being exposed by accident.
 */
export function fileKeyAccess(key: string): FileKeyAccess | null {
	const segments = key.split("/");

	if (segments[0] === "avatars") {
		// Require the owner and a file name, so `avatars/x` cannot be used to
		// probe a prefix.
		return segments.length >= 3 && segments[1].length > 0
			? { visibility: "public" }
			: null;
	}

	if (segments[0] !== "organizations") return null;

	const organizationId = segments[1] ?? "";
	if (!ORGANIZATION_ID_PATTERN.test(organizationId)) return null;

	const rest = segments.slice(2);
	if (rest.length === 0) return null;

	// The first segment after the org id is either a folder or the logo file
	// name. A logo is stored with an extension, so it is always a single
	// segment.
	const folder = rest[0];

	if (rest.length === 1) {
		return { visibility: "public" };
	}

	if (PRIVATE_ORGANIZATION_FOLDERS.has(folder)) {
		return { visibility: "organization", organizationId };
	}

	// Project logos and cached link preview assets stay public. A link preview
	// is a copy of an image the server fetched from a public page, so it is no
	// more sensitive than the page itself, and it is rendered as a bookmark
	// card outside an attachment context.
	if (folder === "projects" || folder === "link-previews") {
		return { visibility: "public" };
	}

	// Unknown folder under the organization: deny rather than guess.
	return null;
}

/** True when a key belongs to a publicly readable upload purpose. */
export function isPublicFileKey(key: string): boolean {
	return fileKeyAccess(key)?.visibility === "public";
}

/** Narrow an arbitrary string to a known upload purpose. */
export function isUploadPurpose(value: string): value is UploadPurpose {
	return (UPLOAD_PURPOSES as readonly string[]).includes(value);
}
