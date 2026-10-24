"use client";

/**
 * The milestone editor plugin set.
 *
 * Why curated instead of a full kit: a milestone description is a short brief,
 * not a document. Every plugin adds bundle weight and another node type the
 * server sanitizer has to understand. This list is the smallest set that covers
 * writing a usable brief: structure, emphasis, lists and links.
 *
 * What is deliberately absent: tables, images, media, mentions, code blocks,
 * AI and collaboration. They can be added later; the sanitizer already refuses
 * node types it does not know, so an old document cannot smuggle one in.
 *
 * Used by: features/milestones/editor/milestone-editor.tsx.
 */

import {
	BlockquotePlugin,
	BoldPlugin,
	CodePlugin,
	H2Plugin,
	H3Plugin,
	ItalicPlugin,
	StrikethroughPlugin,
	UnderlinePlugin,
} from "@platejs/basic-nodes/react";
import { LinkPlugin } from "@platejs/link/react";
import { BulletedListRules, OrderedListRules } from "@platejs/list-classic";
import {
	BulletedListPlugin,
	ListItemContentPlugin,
	ListItemPlugin,
	ListPlugin,
	NumberedListPlugin,
} from "@platejs/list-classic/react";
import { ParagraphPlugin } from "platejs/react";

import {
	BlockquoteElement,
	BoldLeaf,
	BulletedListElement,
	CodeLeaf,
	H2Element,
	H3Element,
	ItalicLeaf,
	LinkElement,
	ListItemContentElement,
	ListItemElement,
	NumberedListElement,
	ParagraphElement,
	StrikethroughLeaf,
	UnderlineLeaf,
} from "./editor-elements";

/** The plugins passed to `usePlateEditor`. */
export const milestoneEditorPlugins = [
	// Blocks
	ParagraphPlugin.withComponent(ParagraphElement),
	H2Plugin.withComponent(H2Element),
	H3Plugin.withComponent(H3Element),
	BlockquotePlugin.withComponent(BlockquoteElement),

	// Lists. `ListPlugin` carries the normalisation and the toggle behaviour,
	// the two list plugins only register the wrappers. Without ListPlugin the
	// toolbar buttons render but the document never gains a list.
	ListPlugin.configure({
		inputRules: [
			BulletedListRules.markdown({ variant: "-" }),
			BulletedListRules.markdown({ variant: "*" }),
			OrderedListRules.markdown({ variant: "." }),
			OrderedListRules.markdown({ variant: ")" }),
		],
	}),
	BulletedListPlugin.withComponent(BulletedListElement),
	NumberedListPlugin.withComponent(NumberedListElement),
	ListItemPlugin.withComponent(ListItemElement),
	ListItemContentPlugin.withComponent(ListItemContentElement),

	// Marks
	BoldPlugin.withComponent(BoldLeaf),
	ItalicPlugin.withComponent(ItalicLeaf),
	UnderlinePlugin.withComponent(UnderlineLeaf),
	StrikethroughPlugin.withComponent(StrikethroughLeaf),
	CodePlugin.withComponent(CodeLeaf),

	// Links
	LinkPlugin.withComponent(LinkElement),
];

/**
 * The empty document.
 *
 * Slate requires at least one text node, so "no details yet" still has a real
 * paragraph to focus. The API stores an empty array for an empty body, and this
 * function is the only place that turns it back into something editable.
 */
export const EMPTY_EDITOR_VALUE = [{ type: "p", children: [{ text: "" }] }];
