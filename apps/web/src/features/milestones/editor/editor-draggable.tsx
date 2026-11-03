"use client";

/**
 * Drag handle for moving top-level blocks.
 *
 * Why not Plate's full registry component: that version depends on the block
 * selection plugin and clones a multi-block preview. This editor only needs to
 * move one section at a time, so the handle is built on the same `useDraggable`
 * and `useDropLine` hooks without pulling in a second selection system.
 *
 * Only root blocks get a handle. List items, quote contents and nested blocks
 * are moved with their parent, which keeps the document structure intact.
 *
 * Used by: features/milestones/editor/editor-kit.tsx.
 */

import { useDraggable, useDropLine } from "@platejs/dnd";
import { cn } from "cn";
import { GripVerticalIcon } from "lucide-react";
import type { PlateElementProps, RenderNodeWrapper } from "platejs/react";

/**
 * Wraps every draggable block with a handle and a drop line.
 *
 * Returning undefined leaves the block untouched. Plate only calls the wrapper
 * for editable editors because `DndPlugin` is edit only, so the client's
 * read-only view never gets a handle.
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
	const { children, element } = props;
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

	return (
		<div
			className={cn(
				// The negative margin plus matching padding extend the hover
				// area into the gutter, so the handle stays visible while the
				// pointer moves from the text to the grip.
				"group/block relative -ml-6 pl-6",
				isDragging && "opacity-50",
			)}
		>
			<div
				aria-hidden
				contentEditable={false}
				className={cn(
					"absolute top-0.5 left-0 z-10 hidden h-7 items-center group-hover/block:flex group-focus-within/block:flex",
					isDragging && "hidden",
				)}
			>
				<div
					ref={handleRef}
					// DndPlugin's dragstart handler reads this to set the move
					// effect and the dragging id. Without it the browser gets no
					// effectAllowed and can show the no-drop cursor.
					data-block-id={element.id}
					data-plate-prevent-deselect
					title="Drag to move"
					className="flex h-7 w-5 cursor-grab items-center justify-center text-app-text-muted transition-colors hover:text-app-text active:cursor-grabbing"
				>
					<GripVerticalIcon className="size-4" aria-hidden />
				</div>
			</div>

			<div ref={nodeRef} className="relative flow-root">
				{/* Makes the gutter part of the drop target, so releasing over the
				    handle column still moves the block instead of showing the
				    no-drop cursor. It sits below the handle in paint order. */}
				<div
					aria-hidden
					contentEditable={false}
					className="absolute inset-y-0 -left-6 w-6"
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
