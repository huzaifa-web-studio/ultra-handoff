"use client";

/**
 * The add or edit link prompt for the floating toolbar.
 *
 * Why a dialog instead of an inline field: the bar has no room for a URL input,
 * and the prompt keeps the https fallback and the existing link prefill out of
 * the toolbar component.
 *
 * The dialog is controlled by its parent. The Slate selection is kept in the
 * editor model while the dialog is open, so applying the link still targets
 * the text the writer selected before the prompt opened.
 *
 * Used by: editor-toolbar.tsx.
 */

import { Button } from "@org/ui/components/button";
import {
	Dialog,
	DialogClose,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@org/ui/components/dialog";
import { Input } from "@org/ui/components/input";
import { upsertLink } from "@platejs/link";
import type { PlateEditor } from "platejs/react";
import { useEditorRef } from "platejs/react";
import { type FormEvent, useEffect, useState } from "react";

/**
 * Read the URL of the link around the current selection, if there is one.
 *
 * Used to prefill the field when the writer edits an existing link instead of
 * adding a new one.
 */
function currentLinkUrl(editor: PlateEditor): string {
	const entry = editor.api.above({
		match: (node) => typeof (node as { url?: unknown }).url === "string",
	});
	const node = entry?.[0] as { url?: unknown } | undefined;

	return typeof node?.url === "string" ? node.url : "";
}

export function EditorLinkDialog({
	isOpen,
	onOpenChange,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const editor = useEditorRef();
	const [url, setUrl] = useState("");

	// Prefill from the current link each time the prompt opens. Clearing on
	// open would silently stack a second link on top of an existing one.
	useEffect(() => {
		if (isOpen) setUrl(currentLinkUrl(editor));
	}, [editor, isOpen]);

	function applyLink(event: FormEvent) {
		event.preventDefault();

		const trimmed = url.trim();
		if (trimmed.length === 0) return;

		// A bare domain is almost always meant as https. Without this the
		// anchor would resolve relative to the app and open nothing useful.
		const href = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
			? trimmed
			: `https://${trimmed}`;

		// Focus first so the model selection is the one the user had selected.
		editor.tf.focus();
		upsertLink(editor, { url: href });
		onOpenChange(false);
	}

	return (
		<Dialog isOpen={isOpen} onOpenChange={onOpenChange} className="sm:max-w-sm">
			<form onSubmit={applyLink} className="flex flex-col gap-4">
				<DialogHeader>
					<DialogTitle>Link</DialogTitle>
					<DialogDescription>
						Paste the address. A bare domain is treated as https.
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-1">
					<label
						htmlFor="editor-link-url"
						className="text-[0.65rem] font-semibold tracking-widest text-app-text-muted uppercase"
					>
						Link URL
					</label>
					<Input
						id="editor-link-url"
						// The dialog exists to enter this one value, so focusing it
						// saves a tab stop on every use.
						autoFocus
						placeholder="https://example.com"
						value={url}
						onChange={(event) => setUrl(event.target.value)}
					/>
				</div>

				<DialogFooter>
					<DialogClose>Cancel</DialogClose>
					<Button type="submit" isDisabled={url.trim().length === 0}>
						Apply link
					</Button>
				</DialogFooter>
			</form>
		</Dialog>
	);
}
