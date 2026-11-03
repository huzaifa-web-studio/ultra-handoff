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

import { Checkbox } from "@org/ui/components/checkbox";
import {
	useTodoListElement,
	useTodoListElementState,
} from "@platejs/list-classic/react";
import { cn } from "cn";
import {
	PlateElement,
	type PlateElementProps,
	PlateLeaf,
	type PlateLeafProps,
} from "platejs/react";
import { Children, type ReactNode } from "react";

import { useEditorStatic } from "./editor-view-context";

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
				"my-3 border-l-4 border-app-focus bg-app-panel-subtle px-3 py-2 text-app-text italic",
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

/**
 * A checklist.
 *
 * The task list is still a `ul`, but the browser marker is removed because
 * every item renders its own checkbox. Keeping it a real list means screen
 * readers still announce the item count.
 */
export function TaskListElement(props: PlateElementProps) {
	return (
		<PlateElement
			{...props}
			as="ul"
			className={cn(
				"my-2 list-none pl-0 text-sm text-app-text",
				props.className,
			)}
		/>
	);
}

/** One plain list item. */
function BaseListItemElement(props: PlateElementProps) {
	return (
		<PlateElement
			{...props}
			as="li"
			className={cn("my-0.5 pl-1", props.className)}
		/>
	);
}

/**
 * One checklist item.
 *
 * list-classic stores the state as `checked` on the list item itself, so the
 * item renderer is what supplies the checkbox. The checkbox is not editable
 * content, otherwise it would become part of the text selection and be copied
 * with the body.
 */
function TaskListItemElement(props: PlateElementProps) {
	const state = useTodoListElementState({ element: props.element });
	const { checkboxProps } = useTodoListElement(state);
	const isStatic = useEditorStatic();

	// The first child is the editable content. Anything after it is a nested
	// list, which has to stay outside the checkbox row.
	const [content, ...nested] = Children.toArray(props.children);

	return (
		<PlateElement
			{...props}
			as="li"
			className={cn("my-0.5 list-none pl-0", props.className)}
		>
			<div className="flex items-start gap-2">
				<div
					className="flex select-none items-center pt-[0.2rem]"
					contentEditable={false}
				>
					<Checkbox
						aria-label={
							state.checked ? "Mark item as not done" : "Mark item as done"
						}
						isDisabled={state.readOnly || isStatic}
						isSelected={checkboxProps.checked}
						onChange={(selected) => checkboxProps.onCheckedChange(selected)}
					/>
				</div>

				<div
					className={cn(
						"min-w-0 flex-1",
						state.checked && "text-app-text-muted line-through",
					)}
				>
					{content}
				</div>
			</div>

			{nested}
		</PlateElement>
	);
}

/** One list item, with or without a checkbox. */
export function ListItemElement(props: PlateElementProps) {
	const checked = (props.element as { checked?: unknown }).checked;

	if (typeof checked === "boolean") {
		return <TaskListItemElement {...props} />;
	}

	return <BaseListItemElement {...props} />;
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
				"cursor-pointer font-medium text-app-focus underline decoration-app-focus/60 underline-offset-4 transition-colors hover:text-app-text hover:decoration-app-text",
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
			{props.children as ReactNode}
		</PlateLeaf>
	);
}
