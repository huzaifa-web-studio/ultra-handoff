/**
 * Public surface of the project conversation module.
 *
 * Why: routes and the project member modules import this folder instead of
 * reaching into its files. The sibling modules import each other directly.
 *
 * Used by: `services/conversation/index.ts`, `routes/projects/messages.ts` and
 * the project member modules.
 */

export {
	getProjectConversationUnread,
	openProjectConversation,
	type ProjectConversationResult,
	type ProjectConversationUnread,
	projectConversationId,
} from "./open";
export {
	addProjectParticipant,
	countActiveParticipants,
	findProjectRoom,
	type ProjectConversationRole,
	removeProjectParticipant,
	setProjectRoomArchived,
	syncProjectParticipants,
	toProjectConversationRole,
	updateProjectParticipantRole,
	upsertProjectParticipant,
	writeMemberCount,
} from "./sync";
