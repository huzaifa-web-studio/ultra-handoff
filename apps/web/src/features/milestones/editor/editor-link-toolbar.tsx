"use client";

/**
 * The floating link insert popover.
 *
 * Why insert only: editing, unlinking and converting to a bookmark now live in
 * the link hover card. Plate's edit mode opens itself whenever the caret lands
 * inside a link, which meant a single click produced both the navigation and an
 * editor popover. Removing the edit hook removes that behaviour completely.
 *
 * What remains is the insert flow: select text, press `Cmd/Ctrl+K` or the
 * toolbar Link button, paste a URL, then press Enter or Apply.
 *
 * Used by: editor-kit.tsx.
 */

import { buttonVariants } from "@org/ui/components/button";
import { Separator } from "@org/ui/components/separator";
import { flip, offset } from "@platejs/floating";
import {
	FloatingLinkUrlInput,
	submitFloatingLink,
	useFloatingLinkInsert,
	useFloatingLinkInsertState,
} from "@platejs/link/react";
import { cn } from "cn";
import { LinkIcon, TextIcon } from "lucide-react";
import { useEditorRef, useFormInputProps } from "platejs/react";

/** Popover shell. */
const PANEL =
	"z-50 flex w-80 flex-col border border-app-border bg-app-panel p-1 shadow-md";

/** Input shell, matching the app's input tokens. */
const INPUT =
	"h-8 w-full border-0 bg-transparent px-2 py-1 text-sm text-app-text outline-none placeholder:text-app-text-muted";

export function EditorFloatingLinkToolbar() {
	const editor = useEditorRef();

	const floatingOptions = {
		placement: "bottom-start" as const,
		middleware: [offset(8), flip({ padding: 12 })],
	};

	const insertState = useFloatingLinkInsertState({ floatingOptions });
	const {
		hidden,
		props: insertProps,
		ref: insertRef,
		textInputProps,
	} = useFloatingLinkInsert(insertState);

	const inputProps = useFormInputProps({
		preventDefaultOnEnterKeydown: true,
	});

	if (hidden) return null;

	return (
		<div ref={insertRef} className={PANEL} {...insertProps}>
			<div className="flex flex-col" {...inputProps}>
				<div className="flex items-center gap-1">
					<LinkIcon
						className="ml-1 size-3.5 shrink-0 text-app-text-muted"
						aria-hidden
					/>
					<FloatingLinkUrlInput
						className={INPUT}
						placeholder="Paste a link"
						data-plate-focus
					/>
				</div>

				<Separator />

				<div className="flex items-center gap-1">
					<TextIcon
						className="ml-1 size-3.5 shrink-0 text-app-text-muted"
						aria-hidden
					/>
					<input
						className={INPUT}
						placeholder="Text to display"
						data-plate-focus
						{...textInputProps}
					/>
				</div>

				<div className="flex items-center justify-between gap-2 border-t border-app-border px-1 pt-1">
					<span className="text-[0.65rem] text-app-text-muted">
						Enter to apply
					</span>
					<button
						type="button"
						className={cn(buttonVariants({ variant: "default", size: "xs" }))}
						onClick={() => submitFloatingLink(editor)}
					>
						Apply
					</button>
				</div>
			</div>
		</div>
	);
}
