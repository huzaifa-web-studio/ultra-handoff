"use client";

/**
 * Block gutter: insert menu and drag handle.
 *
 * Why the gutter: the floating toolbar only exists while text is selected, so
 * anything that creates a new block has no home there. The block gutter is the
 * one place that is always tied to a specific block, so it carries both the
 * insert menu and the drag handle.
 *
 * Only top-level blocks get a gutter. List items, quote contents and table
 * cells are inserted and moved with their parent, which keeps the document
 * structure intact.
 *
 * The insert menu adds the new block after the hovered block. That means the
 * current content is never replaced, and a table never lands inside a list item
 * or another table.
 *
 * Used by: features/milestones/editor/editor-kit.tsx.
 */

import { Button } from "@org/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@org/ui/components/dropdown-menu";
import { useDraggable, useDropLine } from "@platejs/dnd";
import { insertTable } from "@platejs/table";
import { cn } from "cn";
import {
	GripVerticalIcon,
	Heading2Icon,
	Heading3Icon,
	ListIcon,
	ListOrderedIcon,
	ListTodoIcon,
	PlusIcon,
	QuoteIcon,
	TableIcon,
} from "lucide-react";
import { PathApi } from "platejs";
import type { PlateElementProps, RenderNodeWrapper } from "platejs/react";
import { useEditorRef } from "platejs/react";
import {
	createContext,
	type Dispatch,
	type ReactNode,
	type SetStateAction,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";

/** Blocks the insert menu can create. */
type InsertKind = "table" | "checklist" | "h2" | "h3" | "quote" | "ul" | "ol";

/** The one block menu that is open, if any. */
type BlockMenuState = {
	openId: string | null;
	setOpenId: Dispatch<SetStateAction<string | null>>;
};

const BlockMenuContext = createContext<BlockMenuState | null>(null);

/**
 * Coordinates the per-block insert menus.
 *
 * Every block owns a trigger, but only one menu may be open at a time. Without
 * this, hovering a second block while a menu is open can mount a second
 * popover and the two fight over the same place on screen.
 */
export function BlockMenuProvider({ children }: { children: ReactNode }) {
	const [openId, setOpenId] = useState<string | null>(null);

	return (
		<BlockMenuContext.Provider value={{ openId, setOpenId }}>
			{children}
		</BlockMenuContext.Provider>
	);
}

function useBlockMenu(): BlockMenuState {
	const context = useContext(BlockMenuContext);

	if (!context) {
		throw new Error("BlockMenuProvider is missing");
	}

	return context;
}

/** An empty bulleted or numbered list with one item. */
function listNode(type: "ul" | "ol") {
	return {
		type,
		children: [
			{ type: "li", children: [{ type: "lic", children: [{ text: "" }] }] },
		],
	};
}

/** An empty checklist with one unchecked item. */
function taskListNode() {
	return {
		type: "taskList",
		children: [
			{
				type: "li",
				checked: false,
				children: [{ type: "lic", children: [{ text: "" }] }],
			},
		],
	};
}

/**
 * Wraps every draggable block with a gutter.
 *
 * Returning undefined leaves the block untouched. Plate only calls the wrapper
 * for editable editors because `DndPlugin` is edit only, so the client's
 * read-only view never gets a gutter.
 */
export const BlockDraggable: RenderNodeWrapper = (props) => {
	const { editor, element, path } = props;

	// Root blocks only. A path of length 1 is a direct child of the document.
	if (path.length !== 1) return;
	if (!element.id) return;
	if (editor.dom.readOnly) return;

	return (props) => <Draggable {...props} />;
};

function Draggable(props: PlateElementProps) {
	const { children, element, path } = props;
	const blockId = String(element.id);
	const editor = useEditorRef();
	const { openId, setOpenId } = useBlockMenu();
	const menuOpen = openId === blockId;
	const anotherMenuOpen = openId !== null && !menuOpen;
	// Pressing the + opens the menu on the press. Without this, the release of
	// that same press can land on the first item and create it immediately.
	const openedAt = useRef(0);

	// A block can disappear while it owns the open menu, for example when it is
	// deleted. Release the shared slot so other blocks are not blocked forever.
	useEffect(() => {
		return () => {
			setOpenId((current) => (current === blockId ? null : current));
		};
	}, [blockId, setOpenId]);

	const { isDragging, nodeRef, handleRef } = useDraggable({
		element,
		// Explicit move effect so the browser shows the move cursor instead of
		// falling back to its default, which can read as "not allowed".
		drag: { options: { dropEffect: "move" } },
		// The library's default preview is an empty element, which makes the
		// drag ghost disappear. The source block dims and the drop line does the
		// guiding instead.
		preview: { disable: true },
	});

	/**
	 * Add the chosen block at this line.
	 *
	 * An empty paragraph is replaced in place, because adding another block
	 * below it would leave the empty line above the new content. A block with
	 * content keeps its text and the new block is inserted after it.
	 */
	function insert(kind: InsertKind) {
		// Ignore an action that arrived with the same press that opened the menu.
		// A real selection takes longer than this; an accidental click-through
		// is almost always under 100ms.
		if (Date.now() - openedAt.current < 150) return;

		if (kind === "table" && !editor.plugins.table) return;

		const isEmptyParagraph =
			element.type === "p" && editor.api.string(path).trim().length === 0;
		const at = isEmptyParagraph ? path : PathApi.next(path);

		editor.tf.withoutNormalizing(() => {
			if (isEmptyParagraph) editor.tf.removeNodes({ at: path });

			if (kind === "table") {
				insertTable(
					editor,
					{ rowCount: 3, colCount: 3, header: true },
					{ at, select: true },
				);

				// A table with nothing after it has no block where the caret can
				// go when the user clicks below it. Keep an empty paragraph after
				// every table unless the document already has a block there.
				const afterTable = PathApi.next(at);
				if (!editor.api.node(afterTable)) {
					editor.tf.insertNodes(
						{ type: "p", children: [{ text: "" }] },
						{ at: afterTable },
					);
				}
			} else {
				// The menu key is "quote", but the editor's node type is
				// "blockquote". Using the key directly created an unknown block.
				const type = kind === "quote" ? "blockquote" : kind;
				const node =
					kind === "checklist"
						? taskListNode()
						: kind === "ul" || kind === "ol"
							? listNode(kind)
							: { type, children: [{ text: "" }] };

				editor.tf.insertNodes(node, { at });
			}
		});

		// Select a caret at the start of the new block. Selecting the whole
		// inserted node leaves the DOM caret on the previous line.
		const start = editor.api.start(at);
		if (start) editor.tf.select(start);

		// Clear the shared menu slot explicitly. Relying on the menu's close
		// event alone can leave the trigger thinking it is still open, which
		// makes the next + click appear to do nothing.
		setOpenId(null);
		editor.tf.focus();
	}

	return (
		<div
			className={cn(
				// The negative margin and matching padding put the 44px gutter
				// inside the editor's left padding, so the controls never sit
				// outside a scroll container or clip against a border.
				"group/block relative -ml-11 pl-11",
				isDragging && "opacity-50",
			)}
		>
			<div
				contentEditable={false}
				className={cn(
					"absolute top-0.5 left-0 z-10 h-7 w-11 items-center gap-1",
					menuOpen
						? "flex"
						: anotherMenuOpen
							? "hidden"
							: "hidden group-hover/block:flex group-focus-within/block:flex",
					isDragging && "hidden",
				)}
			>
				<DropdownMenuTrigger
					isOpen={menuOpen}
					onOpenChange={(open) => {
						if (open) openedAt.current = Date.now();
						setOpenId(open ? blockId : null);
					}}
				>
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						aria-label="Insert block"
						excludeFromTabOrder
						onMouseDown={(event) => event.preventDefault()}
						className="size-5 shrink-0"
					>
						<PlusIcon className="size-3.5" aria-hidden />
					</Button>
					<DropdownMenu
						placement="right"
						offset={6}
						className="w-auto min-w-48"
					>
						<DropdownMenuItem id="table" onAction={() => insert("table")}>
							<TableIcon aria-hidden />
							Table
						</DropdownMenuItem>
						<DropdownMenuItem
							id="checklist"
							onAction={() => insert("checklist")}
						>
							<ListTodoIcon aria-hidden />
							Checklist
						</DropdownMenuItem>
						<DropdownMenuItem id="h2" onAction={() => insert("h2")}>
							<Heading2Icon aria-hidden />
							Heading 2
						</DropdownMenuItem>
						<DropdownMenuItem id="h3" onAction={() => insert("h3")}>
							<Heading3Icon aria-hidden />
							Heading 3
						</DropdownMenuItem>
						<DropdownMenuItem id="quote" onAction={() => insert("quote")}>
							<QuoteIcon aria-hidden />
							Quote
						</DropdownMenuItem>
						<DropdownMenuItem id="ul" onAction={() => insert("ul")}>
							<ListIcon aria-hidden />
							Bulleted list
						</DropdownMenuItem>
						<DropdownMenuItem id="ol" onAction={() => insert("ol")}>
							<ListOrderedIcon aria-hidden />
							Numbered list
						</DropdownMenuItem>
					</DropdownMenu>
				</DropdownMenuTrigger>

				<div
					ref={handleRef}
					aria-hidden
					data-block-id={element.id}
					data-plate-prevent-deselect
					title="Drag to move"
					className="flex size-5 shrink-0 cursor-grab items-center justify-center text-app-text-muted transition-colors hover:text-app-text active:cursor-grabbing"
				>
					<GripVerticalIcon className="size-4" aria-hidden />
				</div>
			</div>

			<div ref={nodeRef} className="relative flow-root">
				{/* Makes the gutter part of the drop target, so releasing over the
				    handle column still moves the block instead of showing the
				    no-drop cursor. It sits below the controls in paint order. */}
				<div
					aria-hidden
					contentEditable={false}
					className="absolute inset-y-0 -left-11 w-11"
				/>
				{children}
				<DropLine />
			</div>
		</div>
	);
}

/** A line on the block edge the dragged block will land against. */
function DropLine() {
	const { dropLine } = useDropLine();

	if (!dropLine) return null;

	return (
		<div
			aria-hidden
			className={cn(
				"pointer-events-none absolute inset-x-0 h-0.5 bg-app-focus",
				dropLine === "top" ? "-top-px" : "-bottom-px",
			)}
		/>
	);
}
