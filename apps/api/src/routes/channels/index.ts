/**
 * Channel routes.
 *
 * Why a folder: channels reuse the conversation message surface but add their
 * own directory, membership and settings endpoints. Composing small plugins
 * here keeps each file under the size limit and makes the public route list
 * readable in one place.
 *
 * Used by: `src/index.ts`.
 */

import { Elysia } from "elysia";

import { createChannelRoutes } from "./create-channel";
import { channelDirectoryRoutes } from "./directory";
import { channelMembershipRoutes } from "./membership";
import { channelSettingsRoutes } from "./settings";

export const channelRoutes = new Elysia({ name: "channels" })
	.use(channelDirectoryRoutes)
	.use(createChannelRoutes)
	.use(channelMembershipRoutes)
	.use(channelSettingsRoutes);
