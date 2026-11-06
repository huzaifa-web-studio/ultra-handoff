"use client";

/**
 * The mention node plugin.
 *
 * Why a local plugin instead of `@platejs/mention`: the mention feature here is
 * a normal text trigger handled above the editor, not Plate's inline input node
 * combined with an ariakit combobox. That input node was moving focus out of the
 * editor before anybody had chosen a mention. This plugin only teaches the
 * renderer about the stored `mention` node, so a typed `@` stays ordinary text
 * until the picker inserts a chip.
 *
 * Used by: comment-kit.tsx.
 */

import { createPlatePlugin } from "platejs/react";

import { MentionElement } from "./mention-element";

/** Renders the stored mention chip. Shared by the editor and the static view. */
export const MentionPlugin = createPlatePlugin({
	key: "mention",
	node: {
		isElement: true,
		isInline: true,
		isVoid: true,
		isMarkableVoid: true,
	},
}).withComponent(MentionElement);
