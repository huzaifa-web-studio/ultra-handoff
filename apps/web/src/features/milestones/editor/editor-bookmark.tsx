"use client";

/**
 * The bookmark block.
 *
 * Why a block and not only an inline link: a link that is a reference rather
 * than a word in a sentence reads better as a card. The block stores one URL
 * and renders the same cached preview the hover card uses, so there is no
 * second fetch pipeline.
 *
 * Why void: the card is not editable text, and `isVoid` is what tells Slate to
 * treat it as one atomic block for selection, deletion and drag.
 *
 * Used by: editor-kit.tsx and editor-draggable.tsx.
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
import { cn } from "cn";
import { BookmarkIcon, ExternalLinkIcon, LinkIcon } from "lucide-react";
import { NodeApi, type Path, PathApi } from "platejs";
import type { PlateEditor } from "platejs/react";
import {
	createPlatePlugin,
	PlateElement,
	type PlateElementProps,
	useEditorRef,
} from "platejs/react";
import { SlateElement, type SlateElementProps } from "platejs/static";
import { type FormEvent, useState } from "react";
import { BookmarkPreview } from "#/features/link-previews/link-preview-card";
import { useLinkPreview } from "#/features/link-previews/link-preview-context";
import { isPreviewableHref, shortenUrl } from "#/features/link-previews/utils";
import {
	BlockSideIndicator,
	BlockSidePlugin,
	beginBlockSide,
	clearBlockSide,
} from "./editor-block-side";

/** Read the stored URL, ignoring anything that is not a page link. */
function bookmarkUrl(element: unknown): string | undefined {
	const url = (element as { url?: unknown }).url;

	return typeof url === "string" && isPreviewableHref(url) ? url : undefined;
}

/**
 * Insert a bookmark at a path and keep a paragraph below it.
 *
 * A void block at the end of the document leaves nowhere for the caret, which
 * is the same problem the table and image insertions already solve.
 */
export function insertBookmarkNode(
	editor: PlateEditor,
	at: Path,
	url: string,
): void {
	editor.tf.withoutNormalizing(() => {
		editor.tf.insertNodes(
			{ type: "bookmark", url, children: [{ text: "" }] },
			{ at },
		);

		const after = PathApi.next(at);

		if (!editor.api.node(after)) {
			editor.tf.insertNodes(
				{ type: "p", children: [{ text: "" }] },
				{ at: after },
			);
		}
	});

	const below = editor.api.start(PathApi.next(at));
	if (below) editor.tf.select(below);
}

/**
 * Turn an inline link into a bookmark block.
 *
 * Two cases, because they read differently:
 *
 *   - the paragraph only held the link: replace the paragraph with the card
 *   - the link sat inside a sentence: leave the sentence exactly as it is and
 *     place the card on its own block below. Keeping the link is what makes
 *     "Turn into link" a true inverse instead of losing the original text.
 *
 * Runs in one `withoutNormalizing`, so the intermediate state (a removed
 * paragraph before the card exists) never reaches Slate's normaliser.
 */
export function turnLinkIntoBookmark(
	editor: PlateEditor,
	linkPath: Path,
	url: string,
): void {
	const linkNode = editor.api.node(linkPath)?.[0];
	const block = editor.api.above({
		at: linkPath,
		match: (node) => editor.api.isBlock(node),
	});

	if (!block) return;

	const [blockNode, blockPath] = block;
	const linkText = linkNode ? NodeApi.string(linkNode).trim() : "";
	const blockText = NodeApi.string(blockNode).trim();
	const linkOnly =
		blockPath.length === 1 && linkText.length > 0 && blockText === linkText;

	editor.tf.withoutNormalizing(() => {
		const card = {
			type: "bookmark",
			url,
			children: [{ text: "" }],
		};

		if (linkOnly) {
			editor.tf.removeNodes({ at: blockPath });
			editor.tf.insertNodes(card, { at: blockPath });
			return;
		}

		// Any depth below the document is fine for removal, but the card must
		// land at the top level. A card inside a list item would be a block in
		// a block, which no reader can select properly.
		const rootPath = [blockPath[0] ?? 0];
		const at = PathApi.next(rootPath);

		editor.tf.insertNodes(card, { at });

		if (!editor.api.node(PathApi.next(at))) {
			editor.tf.insertNodes(
				{ type: "p", children: [{ text: "" }] },
				{ at: PathApi.next(at) },
			);
		}
	});

	editor.tf.focus();
}

/**
 * Turn a bookmark block back into an inline link.
 *
 * This is the inverse of "Turn into bookmark", so the conversion is never a
 * one way door. The card is replaced by a paragraph holding a real link, with
 * the preview title as the visible text and the URL as the fallback.
 */
export function turnBookmarkIntoLink(
	editor: PlateEditor,
	at: Path,
	url: string,
	text: string,
): void {
	const label = text.trim() || url;

	editor.tf.withoutNormalizing(() => {
		editor.tf.removeNodes({ at });

		editor.tf.insertNodes(
			{
				type: "p",
				children: [
					{
						type: editor.getType("a"),
						url,
						children: [{ text: label }],
					},
				],
			},
			{ at },
		);
	});

	const end = editor.api.end(at);
	if (end) editor.tf.select(end);

	editor.tf.focus();
}

/** A bookmark in the editable body. */
export function BookmarkElement(props: PlateElementProps) {
	const editor = useEditorRef();
	const url = bookmarkUrl(props.element);
	const preview = useLinkPreview(url);

	if (!url) {
		return (
			<PlateElement
				{...props}
				as="div"
				className={cn("my-2", props.className)}
			/>
		);
	}

	/**
	 * Open the link explicitly.
	 *
	 * A plain anchor inside a contenteditable region is not reliably followed
	 * by the browser, which is exactly the "static card" problem. Opening it
	 * from the click handler guarantees the navigation, while modifier clicks
	 * are left alone so the browser can apply its own behaviour.
	 */
	function handleClick(event: React.MouseEvent<HTMLAnchorElement>) {
		// An edge press selects the block for an Enter instead of opening the
		// link. The press already prevented the default, but the click can
		// still follow, so it is stopped here as well.
		if (editor.getOption(BlockSidePlugin, "side")) {
			event.preventDefault();
			return;
		}

		if (
			event.metaKey ||
			event.ctrlKey ||
			event.shiftKey ||
			event.altKey ||
			event.button !== 0
		) {
			return;
		}

		event.preventDefault();
		window.open(url, "_blank", "noopener,noreferrer");
	}

	/**
	 * The inverse of the conversion offered on an inline link, also exposed
	 * here so it is one hover away instead of buried in the insert menu.
	 */
	function convertToLink() {
		if (!url) return;

		const path = editor.api.findPath(props.element);
		if (!path) return;

		// A preview title can be a whole marketing sentence. Use it only when it
		// reads like a label, otherwise fall back to a compact URL.
		const title = preview?.title?.trim();
		const text =
			title && title.length <= 60 ? title : shortenUrl(url, 60) || url;

		turnBookmarkIntoLink(editor, path, url, text);
	}

	return (
		<PlateElement
			{...props}
			as="div"
			className={cn("relative my-3", props.className)}
			attributes={{
				...props.attributes,
				onMouseDown: (event) => {
					if (!beginBlockSide(editor, props.element, event, 16)) {
						clearBlockSide(editor);
					}
				},
			}}
		>
			<BlockSideIndicator element={props.element} />

			{/*
			 * The card is a real link, so a click opens it. A bookmark is a
			 * block, not text, so there is no caret to protect here. The block
			 * is selected and dragged from the gutter instead.
			 */}
			<div contentEditable={false} className="group/bookmark relative">
				<BookmarkPreview href={url} preview={preview} onClick={handleClick} />

				{/*
				 * Kept outside the anchor on purpose: a button nested in an
				 * anchor is invalid markup and the click would bubble into the
				 * navigation.
				 */}
				<div className="pointer-events-none absolute top-1.5 right-1.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/bookmark:pointer-events-auto group-hover/bookmark:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100">
					<Button
						type="button"
						variant="surface"
						size="icon-xs"
						aria-label="Open link"
						onPress={() => window.open(url, "_blank", "noopener,noreferrer")}
					>
						<ExternalLinkIcon aria-hidden />
					</Button>
					<Button
						type="button"
						variant="surface"
						size="icon-xs"
						aria-label="Turn into link"
						onPress={convertToLink}
					>
						<LinkIcon aria-hidden />
					</Button>
				</div>
			</div>

			{/* Plate requires the child to exist even for a void block. */}
			{props.children}
		</PlateElement>
	);
}

/** A bookmark in the read only render. No click handling, so it opens. */
export function BookmarkElementStatic(props: SlateElementProps) {
	const url = bookmarkUrl(props.element);
	const preview = useLinkPreview(url);

	if (!url) return <SlateElement {...props} as="div" />;

	return (
		<SlateElement {...props} as="div" className={cn("my-3", props.className)}>
			<BookmarkPreview href={url} preview={preview} />
			{props.children}
		</SlateElement>
	);
}

/**
 * The plugin registration.
 *
 * `isVoid` keeps the card out of text selection, and `isElement` makes it a
 * normal block for the drag handle, the block menu and the sanitizer's block
 * allowlist.
 */
export const BookmarkPlugin = createPlatePlugin({
	key: "bookmark",
	node: { isElement: true, isVoid: true },
}).withComponent(BookmarkElement);

/** Normalise a typed URL the same way the link prompt does. */
function normalizeUrl(value: string): string | null {
	const trimmed = value.trim();

	if (trimmed.length === 0) return null;

	const href = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
		? trimmed
		: `https://${trimmed}`;

	return isPreviewableHref(href) ? href : null;
}

/**
 * The URL prompt for the block menu.
 *
 * Why a dialog rather than `window.prompt`: the native prompt cannot be styled,
 * cannot validate inline, and blocks the whole page. It is the same reason the
 * link prompt is a dialog.
 */
export function BookmarkDialog({
	isOpen,
	onOpenChange,
	onInsert,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	onInsert: (url: string) => void;
}) {
	const [url, setUrl] = useState("");
	const [invalid, setInvalid] = useState(false);

	function submit(event: FormEvent) {
		event.preventDefault();

		const href = normalizeUrl(url);

		if (!href) {
			setInvalid(true);
			return;
		}

		onInsert(href);
		setUrl("");
		setInvalid(false);
		onOpenChange(false);
	}

	return (
		<Dialog
			isOpen={isOpen}
			onOpenChange={(open) => {
				if (!open) setInvalid(false);
				onOpenChange(open);
			}}
			className="sm:max-w-sm"
		>
			<form onSubmit={submit} className="flex flex-col gap-4">
				<DialogHeader>
					<DialogTitle>Insert bookmark</DialogTitle>
					<DialogDescription>
						Paste a link to show it as a preview card.
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-1">
					<label
						htmlFor="bookmark-url"
						className="text-[0.65rem] font-semibold tracking-widest text-app-text-muted uppercase"
					>
						Link URL
					</label>
					<Input
						id="bookmark-url"
						autoFocus
						placeholder="https://example.com/spec"
						value={url}
						aria-invalid={invalid}
						onChange={(event) => {
							setUrl(event.target.value);
							setInvalid(false);
						}}
					/>
					{invalid ? (
						<p className="text-xs text-danger">
							Enter a full web address, for example https://example.com.
						</p>
					) : null}
				</div>

				<DialogFooter>
					<DialogClose>Cancel</DialogClose>
					<Button type="submit" isDisabled={url.trim().length === 0}>
						<BookmarkIcon aria-hidden />
						Insert
					</Button>
				</DialogFooter>
			</form>
		</Dialog>
	);
}
