"use client";

/**
 * The attachment block inside a milestone description or a comment.
 *
 * Why a custom node: a brief or a discussion can carry any document the upload
 * policy allows, not only images, and Plate has no attachment node out of the
 * box. The bytes live in object storage; the node stores only the URL, the
 * original name, the MIME type and the size, which is everything the card needs
 * to render.
 *
 * Why void: the card is not editable text, and `isVoid` keeps Slate from trying
 * to place a caret inside it. It is a block, so the trailing paragraph rule and
 * the block edge Enter behaviour both apply exactly as they do to an image or a
 * bookmark.
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
	Trash2Icon,
} from "lucide-react";
import {
	createPlatePlugin,
	PlateElement,
	type PlateElementProps,
	useEditorRef,
	useRemoveNodeButton,
	useSelected,
} from "platejs/react";
import { SlateElement, type SlateElementProps } from "platejs/static";

import { resolveAssetUrl } from "#/lib/files";
import {
	BlockSideIndicator,
	beginBlockSide,
	clearBlockSide,
} from "./editor-block-side";

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
function FileTypeIcon({ mime }: { mime: string }) {
	// CSV is a text type but reads better with the sheet icon, so the more
	// specific check comes first.
	if (
		mime.includes("spreadsheet") ||
		mime.includes("excel") ||
		mime === "text/csv"
	) {
		return <FileSpreadsheetIcon className="size-5" aria-hidden />;
	}

	if (mime === "application/pdf" || mime.startsWith("text/")) {
		return <FileTextIcon className="size-5" aria-hidden />;
	}

	if (mime.includes("presentation") || mime.includes("powerpoint")) {
		return <PresentationIcon className="size-5" aria-hidden />;
	}

	if (mime.includes("zip") || mime.includes("compressed")) {
		return <FileArchiveIcon className="size-5" aria-hidden />;
	}

	if (mime.includes("word") || mime.includes("document")) {
		return <FileTextIcon className="size-5" aria-hidden />;
	}

	return <FileIcon className="size-5" aria-hidden />;
}

/** The shared card body, used by both the editable and static renderers. */
function FileCard({
	name,
	mime,
	size,
	href,
}: {
	name: string;
	mime: string;
	size: number | undefined;
	href: string;
}) {
	const meta = [size ? formatSize(size) : null, mime || null]
		.filter(Boolean)
		.join(" · ");

	const content = (
		<>
			<span className="flex size-10 shrink-0 items-center justify-center bg-app-panel-subtle text-app-text-muted">
				<FileTypeIcon mime={mime} />
			</span>

			<span className="flex min-w-0 flex-1 flex-col">
				<span className="truncate text-sm font-medium text-app-text">
					{name}
				</span>
				<span className="truncate text-xs text-app-text-muted">
					{meta || "Attachment"}
				</span>
			</span>

			<span className="flex shrink-0 items-center gap-1 text-app-text-muted">
				<DownloadIcon className="size-4" aria-hidden />
				<span className="text-xs font-medium">Download</span>
			</span>
		</>
	);

	// A real anchor for both surfaces. The card sits inside a
	// `contentEditable=false` wrapper, so the browser follows it normally, and
	// the files route sends attachments with a download disposition.
	return (
		<a
			href={href}
			target="_blank"
			rel="noreferrer noopener"
			className="flex w-full items-center gap-3 border border-app-border bg-app-panel p-3 transition-colors hover:border-app-focus"
		>
			{content}
		</a>
	);
}

/** An attachment in the editable editor. */
export function FileElement(props: PlateElementProps) {
	const editor = useEditorRef();
	const selected = useSelected();
	const remove = useRemoveNodeButton({ element: props.element });

	const url = fileUrl(props.element);
	const src = resolveAssetUrl(url);
	const name = fileName(props.element);
	const mime = fileMime(props.element);
	const size = fileSize(props.element);

	if (!src) {
		return (
			<PlateElement
				{...props}
				as="div"
				className={cn("my-2", props.className)}
			/>
		);
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

			<div
				contentEditable={false}
				className={cn(
					"group/file relative",
					selected && "ring-2 ring-app-focus",
				)}
			>
				<FileCard name={name} mime={mime} size={size} href={src} />

				{/*
				 * Reveal the remove control on hover or keyboard focus, not only
				 * after the block is selected. Selecting first was a hidden extra
				 * step just to find the delete button. On a touch device there is
				 * no hover, so the control stays visible.
				 */}
				<Button
					{...remove.props}
					type="button"
					variant="surface"
					size="icon-xs"
					aria-label="Remove attachment"
					className={cn(
						"absolute -top-2 -right-2 z-30 shadow-sm transition-opacity",
						"pointer-fine:pointer-events-none pointer-fine:opacity-0",
						"pointer-fine:group-hover/file:pointer-events-auto pointer-fine:group-hover/file:opacity-100",
						"pointer-fine:group-focus-within/file:pointer-events-auto pointer-fine:group-focus-within/file:opacity-100",
						selected &&
							"pointer-events-auto opacity-100 pointer-fine:pointer-events-auto pointer-fine:opacity-100",
					)}
				>
					<Trash2Icon aria-hidden />
				</Button>
			</div>

			{/* Plate requires the child to exist even for a void block. */}
			{props.children}
		</PlateElement>
	);
}

/** An attachment in the read only render. */
export function FileElementStatic(props: SlateElementProps) {
	const url = fileUrl(props.element);
	const src = resolveAssetUrl(url);

	if (!src) return <SlateElement {...props} as="div" />;

	return (
		<SlateElement {...props} as="div" className={cn("my-3", props.className)}>
			<FileCard
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
 * The node is a void element so selection, deletion and the block edge Enter
 * behaviour all work without a caret inside the card.
 */
export const FilePlugin = createPlatePlugin({
	key: "file",
	node: { isElement: true, isVoid: true },
}).withComponent(FileElement);
