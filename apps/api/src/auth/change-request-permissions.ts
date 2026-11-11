/**
 * Change request vocabulary and permission rules.
 *
 * Why a separate module: the service, the routes and the mirrored web copy all
 * need the same statuses, limits and decision rules. One module stops the three
 * from drifting apart, exactly like `milestone-permissions.ts` does for
 * milestones.
 *
 * Rules that matter:
 *   - any project member, client included, may raise a change request
 *   - the author may edit or withdraw a request while it is open
 *   - only staff may accept, decline or move a request
 *   - a decision is final, so an accepted, declined, moved or withdrawn request
 *     cannot be decided again
 *
 * Used by: src/services/change-request.service.ts and
 * src/routes/change-requests.ts.
 */

import { APIError } from "better-auth/api";
import {
	canWriteMilestones,
	MILESTONE_TITLE_MAX,
} from "./milestone-permissions";
import { effectiveProjectRole } from "./project-permissions";

/** The states a change request can be in. */
export const CHANGE_REQUEST_STATUSES = [
	"open",
	"accepted",
	"declined",
	"moved",
	"withdrawn",
] as const;

export type ChangeRequestStatus = (typeof CHANGE_REQUEST_STATUSES)[number];

/** Labels for the list, the chips and the email style copy. */
export const CHANGE_REQUEST_STATUS_LABELS: Record<ChangeRequestStatus, string> =
	{
		open: "Open",
		accepted: "Accepted",
		declined: "Declined",
		moved: "Moved",
		withdrawn: "Withdrawn",
	};

/** Longest accepted request title. Matches the milestone title limit. */
export const CHANGE_REQUEST_TITLE_MAX = MILESTONE_TITLE_MAX;

/** Decisions a staff member may make through the patch route. */
export const CHANGE_REQUEST_DECISIONS = ["accepted", "declined"] as const;

export type ChangeRequestDecision = (typeof CHANGE_REQUEST_DECISIONS)[number];

/** True when a value is one of the five request statuses. */
export function isChangeRequestStatus(
	value: string,
): value is ChangeRequestStatus {
	return (CHANGE_REQUEST_STATUSES as readonly string[]).includes(value);
}

/** Reject any status outside the allowlist. */
export function validateChangeRequestStatus(
	value: string,
): ChangeRequestStatus {
	if (!isChangeRequestStatus(value)) {
		throw new APIError("BAD_REQUEST", {
			message: `Unknown change request status: ${value}.`,
		});
	}

	return value;
}

/**
 * Validate and trim a request title.
 *
 * The title becomes a milestone title when the request is moved, so it shares
 * the milestone limit rather than inventing a second one.
 */
export function validateChangeRequestTitle(title: string): string {
	const value = title.trim();

	if (value.length < 1 || value.length > CHANGE_REQUEST_TITLE_MAX) {
		throw new APIError("BAD_REQUEST", {
			message: `The change request title must be between 1 and ${CHANGE_REQUEST_TITLE_MAX} characters.`,
		});
	}

	return value;
}

/**
 * True when the caller may raise a change request.
 *
 * Every project member participates, including the client. That is the point of
 * the surface: the client needs a place to ask for work even when the milestone
 * is locked.
 */
export function canCreateChangeRequest(
	organizationRole: string,
	projectRole: string | null | undefined,
): boolean {
	return effectiveProjectRole(organizationRole, projectRole) !== null;
}

/** True when the caller may accept, decline or move a request. */
export function canDecideChangeRequest(
	organizationRole: string,
	projectRole: string | null | undefined,
): boolean {
	return canWriteMilestones(organizationRole, projectRole);
}

/** True when this caller wrote the request. */
export function isChangeRequestAuthor(
	viewerId: string,
	requestedBy: string | null,
): boolean {
	return requestedBy !== null && requestedBy === viewerId;
}

/**
 * True when this caller may change the title or the body.
 *
 * Author only, and only while the request is still open. Once a decision has
 * been recorded the record is what the client sees, so rewriting it would
 * change history.
 */
export function canEditChangeRequest(input: {
	viewerId: string;
	requestedBy: string | null;
	status: ChangeRequestStatus;
}): boolean {
	return (
		isChangeRequestAuthor(input.viewerId, input.requestedBy) &&
		input.status === "open"
	);
}

/** True when this caller may pull the request back. Author only, while open. */
export function canWithdrawChangeRequest(input: {
	viewerId: string;
	requestedBy: string | null;
	status: ChangeRequestStatus;
}): boolean {
	return (
		isChangeRequestAuthor(input.viewerId, input.requestedBy) &&
		input.status === "open"
	);
}
