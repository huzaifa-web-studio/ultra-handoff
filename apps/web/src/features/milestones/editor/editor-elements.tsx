"use client";

/**
 * Node renderers for the milestone editor.
 *
 * Why hand written: the registry versions are built for a different token set
 * and pull extra dependencies. These are small, semantic elements styled with
 * the app tokens, so the editor matches the rest of the product and there is no
 * second design system in the bundle.
 *
 * `as` is what keeps the output semantic: a heading renders as an `h2`, a list
 * as a `ul`, a link as a real anchor. Screen readers and browser find both
 * depend on the real tag, not on a styled div.
 *
 * Used by: features/milestones/editor/editor-kit.tsx.
 */

import { cn } from "cn";
import {
	PlateElement,
	type PlateElementProps,
	PlateLeaf,
	type PlateLeafProps,
} from "platejs/react";
import type React from "react";

/** Shared body text style. */
const BODY = "my-1 text-sm leading-relaxed text-app-text";

/** A paragraph. */
export function ParagraphElement(props: PlateElementProps) {
	return (
		<PlateElement {...props} as="p" className={cn(BODY, props.className)} />
	);
}

/** A second level heading, the highest level a milestone body needs. */
export function H2Element(props: PlateElementProps) {
	return (
		<PlateElement
			{...props}
			as="h2"
			className={cn(
				"mt-5 mb-2 font-display text-lg font-bold text-app-text",
				props.className,
			)}
		/>
	);
}

/** A third level heading. */
export function H3Element(props: PlateElementProps) {
	return (
		<PlateElement
			{...props}
			as="h3"
			className={cn(
				"mt-4 mb-1.5 font-display text-base font-bold text-app-text",
				props.className,
			)}
		/>
	);
}

/** A block quote, used for pasted decisions and client notes. */
export function BlockquoteElement(props: PlateElementProps) {
	return (
		<PlateElement
			{...props}
			as="blockquote"
			className={cn(
				"my-2 border-l-2 border-app-border-strong pl-3 text-app-text-muted italic",
				props.className,
			)}
		/>
	);
}

/** A bulleted list. */
export function BulletedListElement(props: PlateElementProps) {
	return (
		<PlateElement
			{...props}
			as="ul"
			className={cn(
				"my-2 list-disc pl-5 text-sm text-app-text",
				props.className,
			)}
		/>
	);
}

/** A numbered list. */
export function NumberedListElement(props: PlateElementProps) {
	return (
		<PlateElement
			{...props}
			as="ol"
			className={cn(
				"my-2 list-decimal pl-5 text-sm text-app-text",
				props.className,
			)}
		/>
	);
}

/** One list item. */
export function ListItemElement(props: PlateElementProps) {
	return (
		<PlateElement
			{...props}
			as="li"
			className={cn("my-0.5 pl-1", props.className)}
		/>
	);
}

/**
 * The content wrapper inside a list item.
 *
 * list-classic keeps the editable content in its own `lic` element, so it needs
 * a renderer even though it carries no styling.
 */
export function ListItemContentElement(props: PlateElementProps) {
	return <PlateElement {...props} as="div" className={props.className} />;
}

/** A link. The URL is validated on the server before it is stored. */
export function LinkElement(props: PlateElementProps) {
	const url = (props.element as { url?: unknown }).url;

	// PlateElement's props are typed for the default div, so the anchor
	// attributes are passed through an index signature instead of widening the
	// element component's generic.
	const anchorProps = {
		href: typeof url === "string" ? url : undefined,
		target: "_blank",
		// Opening a stored link must not hand the opener access to the app.
		rel: "noreferrer noopener",
	} as Record<string, unknown>;

	return (
		<PlateElement
			{...props}
			as="a"
			{...anchorProps}
			className={cn(
				"text-app-focus underline underline-offset-4 hover:text-app-text",
				props.className,
			)}
		/>
	);
}

/** Bold text. */
export function BoldLeaf(props: PlateLeafProps) {
	return <PlateLeaf {...props} as="strong" className="font-bold" />;
}

/** Italic text. */
export function ItalicLeaf(props: PlateLeafProps) {
	return <PlateLeaf {...props} as="em" className="italic" />;
}

/** Underlined text. */
export function UnderlineLeaf(props: PlateLeafProps) {
	return (
		<PlateLeaf {...props} as="u" className="underline underline-offset-2" />
	);
}

/** Struck through text. */
export function StrikethroughLeaf(props: PlateLeafProps) {
	return <PlateLeaf {...props} as="s" className="line-through" />;
}

/** Inline code. */
export function CodeLeaf(props: PlateLeafProps) {
	return (
		<PlateLeaf
			{...props}
			as="code"
			className="border border-app-border bg-app-panel-subtle px-1 py-0.5 font-mono text-[0.85em] text-app-text"
		>
			{props.children as React.ReactNode}
		</PlateLeaf>
	);
}
