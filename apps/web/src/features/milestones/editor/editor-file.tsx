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
import {
	DownloadIcon,
	FileArchiveIcon,
	FileIcon,
	FileSpreadsheetIcon,
	FileTextIcon,
	PresentationIcon,
	XIcon,
} from "lucide-react";
import {
	createPlatePlugin,
	PlateElement,
	type PlateElementProps,
	useRemoveNodeButton,
	useSelected,
} from "platejs/react";
import { SlateElement, type SlateElementProps } from "platejs/static";
import type { ReactNode } from "react";

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

/** Human readable size, matching the upload labels elsewhere. */
function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;

	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Pick an icon from the MIME type, falling back to a generic file. */
function FileTypeIcon({
	mime,
	className = "size-5",
}: {
	mime: string;
	className?: string;
}) {
	// CSV is a text type but reads better with the sheet icon, so the more
	// specific check comes first.
	if (
		mime.includes("spreadsheet") ||
		mime.includes("excel") ||
		mime === "text/csv"
	) {
		return <FileSpreadsheetIcon className={className} aria-hidden />;
	}

	if (mime === "application/pdf" || mime.startsWith("text/")) {
		return <FileTextIcon className={className} aria-hidden />;
	}

	if (mime.includes("presentation") || mime.includes("powerpoint")) {
		return <PresentationIcon className={className} aria-hidden />;
	}

	if (mime.includes("zip") || mime.includes("compressed")) {
		return <FileArchiveIcon className={className} aria-hidden />;
	}

	if (mime.includes("word") || mime.includes("document")) {
		return <FileTextIcon className={className} aria-hidden />;
	}

	return <FileIcon className={className} aria-hidden />;
}

/**
 * The visible chip, shared by both renderers.
 *
 * The anchor is the whole body so a click downloads, and the optional trailing
 * control is a sibling rather than a child, because a button cannot live inside
 * an anchor.
 */
function FileChip({
	name,
	mime,
	size,
	href,
	trailing,
}: {
	name: string;
	mime: string;
	size: number | undefined;
	href: string;
	trailing?: ReactNode;
}) {
	const meta = size ? formatSize(size) : "Attachment";

	return (
		<span
			contentEditable={false}
			className="group/file inline-flex max-w-64 items-center border border-app-border bg-app-panel-subtle align-middle text-xs"
		>
			<a
				href={href}
				target="_blank"
				rel="noreferrer noopener"
				title={`${name} (${meta})`}
				className="inline-flex min-w-0 items-center gap-1.5 px-1.5 py-0.5 text-app-text transition-colors hover:text-app-focus"
			>
				<FileTypeIcon mime={mime} className="size-3.5 shrink-0" />
				<span className="truncate font-medium">{name}</span>
				<DownloadIcon
					className="size-3 shrink-0 text-app-text-muted"
					aria-hidden
				/>
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
				href={src}
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
				href={src}
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
