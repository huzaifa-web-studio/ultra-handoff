"use client";

/**
 * The floating formatting toolbar shown over a text selection.
 *
 * Why it floats instead of sitting in a fixed header: the description is a
 * short brief, and a permanent toolbar row competes with the text for space.
 * The bar follows the selection, which is the Medium and Notion behaviour most
 * people expect from a rich text field.
 *
 * The positioning and open/close rules come from `@platejs/floating`, which
 * also handles the hard parts: hiding while the mouse is still down, keeping
 * the bar open while the selection exists, and following the selection on
 * scroll and resize.
 *
 * Every button calls the shared actions in editor-actions.ts, so the context
 * menu exposes exactly the same commands.
 *
 * Used by: features/milestones/editor/milestone-editor.tsx.
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
import {
	FloatingPortal,
	flip,
	offset,
	useFloatingToolbar,
	useFloatingToolbarState,
} from "@platejs/floating";
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
	StrikethroughIcon,
	UnderlineIcon,
} from "lucide-react";
import {
	useEditorId,
	useEditorRef,
	useEditorSelector,
	useEventEditorValue,
} from "platejs/react";
import { useState } from "react";

import { type EditorFormatAction, runFormatAction } from "./editor-actions";
import { EditorLinkDialog } from "./editor-link-dialog";

/** Block types the style select offers. */
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

/** Toggle a bulleted or numbered list. */
function ListButton({
	list,
	label,
	children,
}: {
	list: "ul" | "ol";
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

/** Indent or outdent the selected blocks. */
function IndentButton({ reverse }: { reverse: boolean }) {
	const editor = useEditorRef();
	const action: EditorFormatAction = { type: "indent", reverse };

	return (
		<ToolbarButton
			label={reverse ? "Outdent" : "Indent"}
			onPress={() => runFormatAction(editor, action)}
		>
			{reverse ? (
				<IndentDecreaseIcon aria-hidden />
			) : (
				<IndentIncreaseIcon aria-hidden />
			)}
		</ToolbarButton>
	);
}

/** The block style dropdown, shared with the old header toolbar. */
function BlockSelect() {
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

/** A thin divider between toolbar groups. */
function ToolbarSeparator() {
	return <span aria-hidden className="mx-0.5 h-4 w-px bg-app-border" />;
}

export function EditorFloatingToolbar() {
	const editorId = useEditorId();
	const focusedEditorId = useEventEditorValue("focus");
	const [linkOpen, setLinkOpen] = useState(false);

	const state = useFloatingToolbarState({
		editorId,
		focusedEditorId,
		// The link prompt is modal, so the bar must not sit behind it.
		hideToolbar: linkOpen,
		floatingOptions: {
			placement: "top",
			middleware: [
				offset(8),
				flip({
					padding: 12,
					fallbackPlacements: [
						"top-start",
						"top-end",
						"bottom-start",
						"bottom-end",
					],
				}),
			],
		},
	});
	const {
		clickOutsideRef,
		hidden,
		props: rootProps,
		ref: floatingRef,
	} = useFloatingToolbar(state);

	return (
		<>
			{/* Kept mounted even while hidden, otherwise opening the link prompt
			    (which hides the bar) would unmount the dialog in the same pass. */}
			{!hidden && (
				<FloatingPortal>
					<div ref={clickOutsideRef}>
						<div
							{...rootProps}
							ref={floatingRef}
							role="toolbar"
							aria-label="Text formatting"
							className="ignore-click-outside/toolbar flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-1 border border-app-border bg-app-panel p-1 shadow-md"
						>
							<BlockSelect />

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

							<ListButton list="ul" label="Bulleted list">
								<ListIcon aria-hidden />
							</ListButton>
							<ListButton list="ol" label="Numbered list">
								<ListOrderedIcon aria-hidden />
							</ListButton>

							<ToolbarSeparator />

							<IndentButton reverse />
							<IndentButton reverse={false} />

							<ToolbarSeparator />

							<ToolbarButton label="Link" onPress={() => setLinkOpen(true)}>
								<LinkIcon aria-hidden />
							</ToolbarButton>
						</div>
					</div>
				</FloatingPortal>
			)}

			<EditorLinkDialog isOpen={linkOpen} onOpenChange={setLinkOpen} />
		</>
	);
}
