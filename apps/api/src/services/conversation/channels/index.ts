/**
 * Public surface of the channel module.
 *
 * Why a folder and a barrel: create, directory, membership and settings are
 * separate concerns, but routes and the realtime layer should import one entry
 * point. Internal files import their siblings directly, never through this
 * barrel, so an import cycle cannot form.
 *
 * Used by: `services/conversation/index.ts` and `routes/channels/`.
 */

export { type ChannelResult, createChannel } from "./create";
export {
	browseChannels,
	decodeBrowseCursor,
	encodeBrowseCursor,
	listArchivedChannels,
	listChannels,
} from "./directory";
export {
	addChannelMembers,
	joinChannel,
	type LeaveChannelResult,
	leaveChannel,
	type RemoveChannelMemberResult,
	removeChannelMember,
	setChannelMemberRole,
	setChannelMuted,
} from "./membership";
export {
	setChannelArchived,
	type UpdateChannelResult,
	updateChannel,
} from "./settings";
export {
	assertWorkspaceMembers,
	normalizeChannelDescription,
	normalizeChannelTitle,
	normalizeMemberIds,
	normalizeVisibility,
} from "./validate";
