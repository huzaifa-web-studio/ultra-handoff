"use client";

/**
 * Interactive checklists in a rendered comment.
 *
 * Why this exists: a checklist item is shared state. Anyone who can comment
 * should be able to tick it, even though they cannot edit the author's text. The
 * static Plate renderer would normally disable every form control, so this
 * replaces only the checklist item renderer with one that calls a dedicated
 * toggle endpoint.
 *
 * The checkbox is controlled by the stored comment body. A successful toggle
 * patches the cache, the body remounts, and the box shows the new state.
 *
 * Used by: comments/editor/comment-kit.tsx and comments/editor/comment-editor.tsx.
 */

import { Checkbox } from "@org/ui/components/checkbox";
import { cn } from "cn";
import { PlateElement, type PlateElementProps } from "platejs/react";
import {
	Children,
	createContext,
	useContext,
	useEffect,
	useState,
} from "react";

import { ListItemElement } from "#/components/rich-text/editor-elements";

/** What a rendered checklist needs from the comment it belongs to. */
type CommentChecklistContextValue = {
	/** True while a toggle is in flight or the viewer cannot comment. */
	disabled: boolean;
	/** Null when there is no way to save a change. */
	onToggle: ((itemId: string, checked: boolean) => Promise<void>) | null;
};

const CommentChecklistContext = createContext<CommentChecklistContextValue>({
	disabled: true,
	onToggle: null,
});

export function CommentChecklistProvider({
	value,
	children,
}: {
	value: CommentChecklistContextValue;
	children: React.ReactNode;
}) {
	return (
		<CommentChecklistContext.Provider value={value}>
			{children}
		</CommentChecklistContext.Provider>
	);
}

/** Read the toggle permission for the comment body being rendered. */
export function useCommentChecklist(): CommentChecklistContextValue {
	return useContext(CommentChecklistContext);
}

/**
 * A checklist item in the read only render.
 *
 * A normal list item falls through to the shared renderer. A checklist item gets
 * an enabled checkbox and keeps the same layout as the editable version.
 */
export function CommentStaticListItemElement(props: PlateElementProps) {
	// All hooks run before the plain list item early return.
	const { disabled, onToggle } = useCommentChecklist();
	const checked = (props.element as { checked?: unknown }).checked;

	// Show the new state immediately, and roll back if the request fails. A
	// successful toggle updates the body and remounts this item, so the local
	// value resets to the stored one.
	const [optimisticChecked, setOptimisticChecked] = useState<boolean>(
		checked === true,
	);

	useEffect(() => {
		if (typeof checked === "boolean") setOptimisticChecked(checked);
	}, [checked]);

	if (typeof checked !== "boolean") {
		return <ListItemElement {...props} />;
	}

	const itemId = (props.element as { id?: unknown }).id;
	const [content, ...nested] = Children.toArray(props.children);
	const canToggle =
		typeof itemId === "string" && !disabled && onToggle !== null;

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
							optimisticChecked ? "Mark item as not done" : "Mark item as done"
						}
						isDisabled={!canToggle}
						isSelected={optimisticChecked}
						onChange={(selected) => {
							if (typeof itemId !== "string" || disabled || !onToggle) {
								return;
							}

							setOptimisticChecked(selected);
							void onToggle(itemId, selected).catch(() => {
								setOptimisticChecked(checked);
							});
						}}
					/>
				</div>

				<div
					className={cn(
						"min-w-0 flex-1",
						optimisticChecked && "text-app-text-muted line-through",
					)}
				>
					{content}
				</div>
			</div>

			{nested}
		</PlateElement>
	);
}
