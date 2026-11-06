"use client";

/**
 * Small formatting controls shared by the milestone floating toolbar and the
 * fixed comment composer toolbar.
 *
 * Why extracted: both surfaces expose the same marks and lists, and two copies
 * of the pressed state logic would drift the moment one gains a new mark. The
 * presentation lives here, the commands stay in `editor-actions.ts`.
 *
 * Used by: editor-toolbar.tsx and comments/editor/comment-toolbar.tsx.
 */

import { Button } from "@org/ui/components/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@org/ui/components/select";
import { Tooltip, TooltipTrigger } from "@org/ui/components/tooltip";
import { cn } from "cn";
import { useEditorRef, useEditorSelector } from "platejs/react";

import { runFormatAction } from "./editor-actions";

/** One icon button with a tooltip and a pressed state. */
export function ToolbarButton({
	label,
	active = false,
	disabled = false,
	onPress,
	children,
}: {
	label: string;
	active?: boolean;
	/** True while an upload or another blocking action is running. */
	disabled?: boolean;
	onPress: () => void;
	children: React.ReactNode;
}) {
	return (
		<TooltipTrigger>
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				aria-label={label}
				aria-pressed={active}
				isDisabled={disabled}
				// Keep the selection in the editor while a control is pressed.
				onMouseDown={(event) => event.preventDefault()}
				onPress={onPress}
				className={cn(active && "bg-app-selected text-app-text")}
			>
				{children}
			</Button>
			<Tooltip>{label}</Tooltip>
		</TooltipTrigger>
	);
}

/** Toggle one mark on the current selection. */
export function MarkButton({
	mark,
	label,
	children,
}: {
	mark: "bold" | "italic" | "underline" | "strikethrough" | "code";
	label: string;
	children: React.ReactNode;
}) {
	const editor = useEditorRef();
	const active = useEditorSelector(
		(current) =>
			current.api.some({
				match: (node) => (node as Record<string, unknown>)[mark] === true,
			}),
		[mark],
	);

	return (
		<ToolbarButton
			label={label}
			active={active}
			onPress={() => runFormatAction(editor, { type: "mark", mark })}
		>
			{children}
		</ToolbarButton>
	);
}

/** Toggle a bulleted, numbered or checklist list. */
export function ListButton({
	list,
	label,
	children,
}: {
	list: "ul" | "ol" | "taskList";
	label: string;
	children: React.ReactNode;
}) {
	const editor = useEditorRef();
	const active = useEditorSelector(
		(current) =>
			current.api.some({
				match: (node) =>
					(node as { type?: unknown }).type === current.getType(list),
			}),
		[list],
	);

	return (
		<ToolbarButton
			label={label}
			active={active}
			onPress={() => runFormatAction(editor, { type: "list", list })}
		>
			{children}
		</ToolbarButton>
	);
}

/** A thin divider between toolbar groups. */
export function ToolbarSeparator() {
	return <span aria-hidden className="mx-0.5 h-4 w-px bg-app-border" />;
}

/** Block types the style select offers. */
const BLOCK_OPTIONS = [
	{ id: "p", label: "Paragraph" },
	{ id: "h2", label: "Heading 2" },
	{ id: "h3", label: "Heading 3" },
	{ id: "blockquote", label: "Quote" },
] as const;

/** The block style dropdown, shared by both toolbars. */
export function BlockSelect() {
	const editor = useEditorRef();

	// The nearest block whose type the select offers. Without the ancestor
	// search, a cursor inside a list would report `lic`, which is not an option
	// and would leave the select showing an empty value.
	const currentType = useEditorSelector((current) => {
		const entry = current.api.above({
			match: (node) => {
				const type = (node as { type?: unknown }).type;

				return (
					typeof type === "string" &&
					BLOCK_OPTIONS.some((option) => option.id === type)
				);
			},
		});
		const node = entry?.[0] as { type?: unknown } | undefined;

		return typeof node?.type === "string" ? node.type : "p";
	}, []);

	return (
		<Select
			aria-label="Text style"
			selectedKey={currentType}
			onSelectionChange={(key) => {
				if (typeof key !== "string" || key === currentType) return;

				runFormatAction(editor, {
					type: "block",
					block: key as "p" | "h2" | "h3" | "blockquote",
				});
			}}
		>
			<SelectTrigger size="sm" className="w-32">
				<SelectValue />
			</SelectTrigger>
			<SelectContent className="ignore-click-outside/toolbar min-w-40">
				{BLOCK_OPTIONS.map((option) => (
					<SelectItem key={option.id} id={option.id}>
						{option.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
