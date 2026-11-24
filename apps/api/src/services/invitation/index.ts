/**
 * Public surface of the invitation module.
 *
 * Why: the member and invitation routes should import one entry point instead
 * of reaching into individual files. Every name the old
 * `invitation/` exported is re-exported here.
 *
 * Used by: `routes/members.ts` and `routes/invitations.ts`.
 */

export { bulkCancelInvitations } from "./cancel";
export { bulkInviteMembers } from "./invite";
export { listInvitationHistory } from "./list";
export { sendInvitationMagicLink } from "./magic-link";
export { previewInvitation } from "./preview";
export { bulkResendInvitations } from "./resend";
export type {
	InvitationHistoryItem,
	InvitationHistoryQuery,
	InvitationHistoryResult,
	InvitationPreview,
	InvitationRole,
	InvitationStatus,
} from "./types";
