/**
 * Business tables (Handoff owned data).
 *
 * Scope: everything Handoff owns. Better Auth tables (`user`, `session`,
 * `account`, `verification`, `organization`, `member`, `invitation`) live in
 * auth-schema.ts and are only touched through the auth API.
 *
 * Every table here carries `organization_id`, an index on it and the
 * `tenantIsolation` policy, then enables row level security. Queries run as
 * the unprivileged `app_tenant` role through `withTenant`, so the policy is
 * what enforces the workspace boundary.
 *
 * Why a folder: the tables are grouped by domain so each file stays readable.
 * `schema-bundle.ts` and drizzle-kit both read this index, so the database
 * model is still one schema.
 *
 * Used by: src/db/schema-bundle.ts and src/services/.
 */

export { changeRequest, milestoneScopeEntry } from "./change-request";
export { comment, commentThreadRead } from "./comment";
export {
	conversation,
	conversationMessage,
	conversationParticipant,
	conversationThreadRead,
} from "./conversation";
export { linkPreview } from "./link-preview";
export {
	milestone,
	milestoneAssignee,
	milestoneStatusPeriod,
} from "./milestone";
export { notification } from "./notification";
export { project, projectMember, projectPin } from "./project";
export { pushSubscription } from "./push-subscription";
