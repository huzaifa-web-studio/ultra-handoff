"use client";

/**
 * The inline attachment chip inside a milestone description or a comment.
 *
 * Why a custom node: a brief or a discussion can carry any document the upload
 * policy allows, not only images, and Plate has no attachment node out of the
 * box. The bytes live in object storage; the node stores only the URL, the
 * original name, the MIME type and the size, which is everything the chip needs
 * to render.
 *
 * Why inline and void: the product wants text before and after an attachment on
 * the same line, so the chip flows inside the paragraph rather than owning a
 * line. `isVoid` keeps Slate from placing a caret inside the card, while
 * `isInline` makes it move with the surrounding text.
 *
 * Used by: editor-kit.tsx, which registers it for both editor surfaces.
 */

import { Button } from "@org/ui/components/button";
import { cn } from "cn";
import { DownloadIcon, XIcon } from "lucide-react";
import {
	createPlatePlugin,
	PlateElement,
	type PlateElementProps,
	useRemoveNodeButton,
	useSelected,
} from "platejs/react";
import { SlateElement, type SlateElementProps } from "platejs/static";
import type { ReactNode } from "react";
import { fileDownloadUrl } from "#/features/files/download-url";
import { FileTypeIcon } from "#/features/files/file-type-icon";
import { useFileViewer } from "#/features/files/file-viewer-provider";
import { formatFileSize } from "#/features/files/format";
import { resolveAssetUrl } from "#/lib/files";

/** Read the stored URL, if any. */
function fileUrl(element: unknown): string | undefined {
	const url = (element as { url?: unknown }).url;

	return typeof url === "string" && url.length > 0 ? url : undefined;
}

/** Read the stored display name, with a safe fallback. */
function fileName(element: unknown): string {
	const name = (element as { name?: unknown }).name;

	return typeof name === "string" && name.trim().length > 0
		? name.trim()
		: "Attachment";
}

/** Read the stored MIME type. Used only to pick an icon. */
function fileMime(element: unknown): string {
	const mime = (element as { mime?: unknown }).mime;

	return typeof mime === "string" ? mime : "";
}

/** Read the stored size in bytes, if it is a plausible value. */
function fileSize(element: unknown): number | undefined {
	const size = (element as { size?: unknown }).size;

	return typeof size === "number" && Number.isFinite(size) && size >= 0
		? size
		: undefined;
}

/**
 * The visible chip, shared by both renderers.
 *
 * The name opens the preview dialog and the download icon downloads the file.
 * They are separate controls because an anchor cannot contain a button, and
 * the trailing remove control is a third sibling for the same reason.
 */
function FileChip({
	name,
	mime,
	size,
	src,
	trailing,
}: {
	name: string;
	mime: string;
	size: number | undefined;
	src: string;
	trailing?: ReactNode;
}) {
	const viewer = useFileViewer();
	const meta = formatFileSize(size) ?? "Attachment";

	return (
		<span
			contentEditable={false}
			className="group/file inline-flex max-w-64 items-center border border-app-border bg-app-panel-subtle align-middle text-xs"
		>
			<button
				type="button"
				aria-haspopup="dialog"
				aria-label={`Preview ${name}`}
				title={`Preview ${name} (${meta})`}
				onClick={() => viewer.open({ name, mime, size, src })}
				onMouseDown={(event) => event.stopPropagation()}
				className="inline-flex min-w-0 cursor-pointer items-center gap-1.5 px-1.5 py-0.5 text-left text-app-text transition-colors hover:text-app-focus"
			>
				<FileTypeIcon name={name} mime={mime} />
				<span className="truncate font-medium">{name}</span>
			</button>

			<a
				href={fileDownloadUrl(src)}
				aria-label={`Download ${name}`}
				title={`Download ${name}`}
				onMouseDown={(event) => event.stopPropagation()}
				className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center text-app-text-muted transition-colors hover:text-app-focus"
			>
				<DownloadIcon className="size-3" aria-hidden />
			</a>

			{trailing}
		</span>
	);
}

/** An attachment chip in the editable editor. */
export function FileElement(props: PlateElementProps) {
	const selected = useSelected();
	const remove = useRemoveNodeButton({ element: props.element });

	const url = fileUrl(props.element);
	const src = resolveAssetUrl(url);

	if (!src) {
		return (
			<PlateElement
				{...props}
				as="span"
				className={cn("mx-0.5", props.className)}
			/>
		);
	}

	return (
		<PlateElement
			{...props}
			as="span"
			className={cn("mx-0.5 align-baseline", props.className)}
		>
			<FileChip
				name={fileName(props.element)}
				mime={fileMime(props.element)}
				size={fileSize(props.element)}
				src={src}
				trailing={
					/*
					 * Reveal the remove control on hover or keyboard focus, not only
					 * after the chip is selected. On a touch device there is no hover,
					 * so the control stays visible.
					 */
					<Button
						{...remove.props}
						type="button"
						variant="ghost"
						size="icon-xs"
						aria-label="Remove attachment"
						className={cn(
							"mr-0.5 size-4 shrink-0 text-app-text-muted transition-opacity",
							"pointer-fine:pointer-events-none pointer-fine:opacity-0",
							"pointer-fine:group-hover/file:pointer-events-auto pointer-fine:group-hover/file:opacity-100",
							"pointer-fine:group-focus-within/file:pointer-events-auto pointer-fine:group-focus-within/file:opacity-100",
							selected &&
								"pointer-events-auto opacity-100 pointer-fine:pointer-events-auto pointer-fine:opacity-100",
						)}
					>
						<XIcon aria-hidden />
					</Button>
				}
			/>

			{/* Plate requires the child to exist even for a void inline node. */}
			{props.children}
		</PlateElement>
	);
}

/** An attachment chip in the read only render. */
export function FileElementStatic(props: SlateElementProps) {
	const url = fileUrl(props.element);
	const src = resolveAssetUrl(url);

	if (!src) return <SlateElement {...props} as="span" />;

	return (
		<SlateElement
			{...props}
			as="span"
			className={cn("mx-0.5 align-baseline", props.className)}
		>
			<FileChip
				name={fileName(props.element)}
				mime={fileMime(props.element)}
				size={fileSize(props.element)}
				src={src}
			/>
			{props.children}
		</SlateElement>
	);
}

/**
 * The plugin registration.
 *
 * The node is inline and void, so it flows inside a paragraph and Slate never
 * places a caret inside the chip.
 */
export const FilePlugin = createPlatePlugin({
	key: "file",
	node: { isElement: true, isInline: true, isVoid: true },
}).withComponent(FileElement);
