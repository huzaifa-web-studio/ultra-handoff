"use client";

/**
 * The milestone editor toolbar.
 *
 * Why hand built: the ready made Plate toolbars assume Radix and a different
 * token set. This one is a small, curated set of controls built from the app's
 * own Button, Select, Input and Popover, so it looks like every other surface
 * and only exposes the marks and blocks the editor actually supports.
 *
 * Keyboard and selection detail: every control prevents the default mousedown
 * so clicking it does not steal focus from the contenteditable. Slate keeps the
 * last selection, which is what makes applying a mark to selected text work.
 *
 * Used by: features/milestones/editor/milestone-editor.tsx.
 */

import { Button } from "@org/ui/components/button";
import { Input } from "@org/ui/components/input";
import { Popover, PopoverTrigger } from "@org/ui/components/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@org/ui/components/select";
import { Tooltip, TooltipTrigger } from "@org/ui/components/tooltip";
import { useIndentButton, useOutdentButton } from "@platejs/indent/react";
import { upsertLink } from "@platejs/link";
import {
	useListToolbarButton,
	useListToolbarButtonState,
} from "@platejs/list-classic/react";
import { cn } from "cn";
import {
	BoldIcon,
	CodeIcon,
	IndentDecreaseIcon,
	IndentIncreaseIcon,
	ItalicIcon,
	LinkIcon,
	ListIcon,
	ListOrderedIcon,
	Redo2Icon,
	StrikethroughIcon,
	UnderlineIcon,
	Undo2Icon,
} from "lucide-react";
import { useEditorRef, useEditorSelector } from "platejs/react";
import { useState } from "react";

/** Block types the "style" select offers. */
const BLOCK_OPTIONS = [
	{ id: "p", label: "Paragraph" },
	{ id: "h2", label: "Heading 2" },
	{ id: "h3", label: "Heading 3" },
	{ id: "blockquote", label: "Quote" },
] as const;

/** One icon button with a tooltip and a pressed state. */
function ToolbarButton({
	label,
	active = false,
	onPress,
	children,
}: {
	label: string;
	active?: boolean;
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
function MarkButton({
	mark,
	label,
	children,
}: {
	mark: string;
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
			onPress={() => {
				editor.tf.toggleMark(mark);
				editor.tf.focus();
			}}
		>
			{children}
		</ToolbarButton>
	);
}

/** Toggle a bulleted or numbered list. */
function ListButton({
	nodeType,
	label,
	children,
}: {
	nodeType: "ul" | "ol";
	label: string;
	children: React.ReactNode;
}) {
	const editor = useEditorRef();
	const state = useListToolbarButtonState({ nodeType });
	const { props } = useListToolbarButton(state);

	return (
		<ToolbarButton
			label={label}
			active={props.pressed}
			onPress={() => {
				props.onClick();
				editor.tf.focus();
			}}
		>
			{children}
		</ToolbarButton>
	);
}

/** Indent the current block. */
function IndentButton() {
	const { props } = useIndentButton();
	const editor = useEditorRef();

	return (
		<ToolbarButton
			label="Indent"
			onPress={() => {
				props.onClick();
				// Keep the contenteditable focused so the user can keep typing.
				editor.tf.focus();
			}}
		>
			<IndentIncreaseIcon aria-hidden />
		</ToolbarButton>
	);
}

/** Outdent the current block. */
function OutdentButton() {
	const { props } = useOutdentButton();
	const editor = useEditorRef();

	return (
		<ToolbarButton
			label="Outdent"
			onPress={() => {
				props.onClick();
				editor.tf.focus();
			}}
		>
			<IndentDecreaseIcon aria-hidden />
		</ToolbarButton>
	);
}

/**
 * Insert or update a link.
 *
 * A popover with one field instead of the full floating link toolbar: the
 * milestone body needs links, not link editing affordances at the cursor. If
 * the selection is already inside a link, the existing link is updated rather
 * than nested.
 */
function LinkButton() {
	const editor = useEditorRef();
	const [open, setOpen] = useState(false);
	const [url, setUrl] = useState("");

	function applyLink(event: React.FormEvent) {
		event.preventDefault();

		const trimmed = url.trim();
		if (trimmed.length === 0) return;

		// A bare domain is almost always meant as https. Without this the
		// anchor would resolve relative to the app and open nothing useful.
		const href = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
			? trimmed
			: `https://${trimmed}`;

		editor.tf.focus();
		upsertLink(editor, { url: href });
		setUrl("");
		setOpen(false);
	}

	return (
		<PopoverTrigger isOpen={open} onOpenChange={setOpen}>
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				aria-label="Add link"
				onMouseDown={(event) => event.preventDefault()}
				// DialogTrigger owns the open state; adding an onPress here would
				// toggle it twice and appear to do nothing.
				className={cn(open && "bg-app-selected text-app-text")}
			>
				<LinkIcon aria-hidden />
			</Button>
			<Popover className="w-72 p-3">
				<form onSubmit={applyLink} className="flex flex-col gap-2">
					<Input
						// The popover only opens on an explicit press, so focusing the
						// only field is the expected next step.
						autoFocus
						aria-label="Link URL"
						placeholder="https://example.com"
						value={url}
						onChange={(event) => setUrl(event.target.value)}
					/>
					<div className="flex justify-end gap-2">
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onPress={() => setOpen(false)}
						>
							Cancel
						</Button>
						<Button
							type="submit"
							size="sm"
							isDisabled={url.trim().length === 0}
						>
							Add
						</Button>
					</div>
				</form>
			</Popover>
		</PopoverTrigger>
	);
}

/** A thin divider between toolbar groups. */
function ToolbarSeparator() {
	return <span aria-hidden className="mx-0.5 h-4 w-px bg-app-border" />;
}

export function EditorToolbar() {
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
		<div
			role="toolbar"
			aria-label="Formatting"
			className="flex flex-wrap items-center gap-1 border-b border-app-border bg-app-panel-subtle px-1 py-1"
		>
			<Select
				aria-label="Text style"
				selectedKey={currentType}
				onSelectionChange={(key) => {
					if (typeof key !== "string" || key === currentType) return;

					editor.tf.toggleBlock(key);
					editor.tf.focus();
				}}
			>
				<SelectTrigger size="sm" className="w-32">
					<SelectValue />
				</SelectTrigger>
				<SelectContent className="min-w-40">
					{BLOCK_OPTIONS.map((option) => (
						<SelectItem key={option.id} id={option.id}>
							{option.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>

			<ToolbarSeparator />

			<MarkButton mark="bold" label="Bold">
				<BoldIcon aria-hidden />
			</MarkButton>
			<MarkButton mark="italic" label="Italic">
				<ItalicIcon aria-hidden />
			</MarkButton>
			<MarkButton mark="underline" label="Underline">
				<UnderlineIcon aria-hidden />
			</MarkButton>
			<MarkButton mark="strikethrough" label="Strikethrough">
				<StrikethroughIcon aria-hidden />
			</MarkButton>
			<MarkButton mark="code" label="Inline code">
				<CodeIcon aria-hidden />
			</MarkButton>

			<ToolbarSeparator />

			<ListButton nodeType="ul" label="Bulleted list">
				<ListIcon aria-hidden />
			</ListButton>
			<ListButton nodeType="ol" label="Numbered list">
				<ListOrderedIcon aria-hidden />
			</ListButton>

			<OutdentButton />
			<IndentButton />

			<LinkButton />

			<ToolbarSeparator />

			<ToolbarButton
				label="Undo"
				onPress={() => {
					editor.tf.undo();
					editor.tf.focus();
				}}
			>
				<Undo2Icon aria-hidden />
			</ToolbarButton>
			<ToolbarButton
				label="Redo"
				onPress={() => {
					editor.tf.redo();
					editor.tf.focus();
				}}
			>
				<Redo2Icon aria-hidden />
			</ToolbarButton>
		</div>
	);
}
