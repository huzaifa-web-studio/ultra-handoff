/**
 * Shared shape for a bulk action outcome.
 *
 * Why one module: members, invitations and projects all run per item loops and
 * return the same kind of partial failure. Keeping the shape in one place means
 * the browser can render every bulk result with one component, and adding a new
 * bulk action only needs a new status value here.
 *
 * Used by: member.service.ts, invitation.service.ts and project.service.ts.
 */

/** One item's outcome. Partial failure is a normal result, not an error. */
export type BulkItemStatus =
	| "invited"
	| "resent"
	| "removed"
	| "canceled"
	| "updated"
	| "archived"
	| "restored"
	| "deleted"
	| "added"
	| "skipped"
	| "failed";

export type BulkItemResult = {
	key: string;
	label: string;
	status: BulkItemStatus;
	code?: string;
	message: string;
};

export type BulkResult = { results: BulkItemResult[] };
