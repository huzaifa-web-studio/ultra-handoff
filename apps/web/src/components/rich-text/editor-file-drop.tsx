"use client";

/**
 * Drop files from the computer straight into a rich text editor.
 *
 * Why this exists: Slate intercepts every drop, calls `preventDefault` and then
 * only knows how to insert text, HTML and Slate fragments. A file dragged from
 * the desktop never reaches an upload path, so the drop silently disappears.
 * The Plate media plugin cannot cover it either, because its built in upload
 * stores a base64 data URL that the API sanitizer refuses.
 *
 * This hook adds the missing path. It reuses the same presigned uploads, the
 * same validation and the same organization switch guard as the toolbar
 * pickers, so a dropped file is indistinguishable from a picked one once it
 * lands in the document.
 *
 * Behaviour:
 *   - only real file drags are claimed, so text drops, URL drops and internal
 *     block reordering keep working exactly as before
 *   - the drop point comes from the pointer, not the caret, so the chip lands
 *     where the writer released it
 *   - several files are uploaded one at a time and inserted in order
 *   - one rejected file does not cancel the rest of the drop
 *
 * Used by: editor/milestone-editor.tsx and comments/editor/comment-editor.tsx.
 */

import { PathApi, type TRange } from "platejs";
import type { PlateEditor } from "platejs/react";
import { type DragEvent, useState } from "react";
import { toast } from "sonner";

import { beginOrganizationOperation } from "#/features/organization/switch-guard";
import {
	type UploadPurpose,
	uploadFile,
	validateUploadFile,
} from "#/lib/upload";
import {
	insertInlineNode,
	insertVoidBlock,
	resolveInsertPoint,
} from "./editor-insert";
import { fileNode, imageNode } from "./editor-nodes";

/** Image purposes a drop can use. Each tenant folder is separate. */
type DropImagePurpose = Extract<
	UploadPurpose,
	"milestone-image" | "comment-image"
>;

/** Attachment purpose a drop can use. */
type DropFilePurpose = Extract<
	UploadPurpose,
	"comment-file" | "milestone-file"
>;

/** The DOM handlers a host spreads onto `PlateContent`. */
export type EditorDropProps = {
	onDragEnter: (event: DragEvent<HTMLDivElement>) => void;
	onDragOver: (event: DragEvent<HTMLDivElement>) => void;
	onDragLeave: (event: DragEvent<HTMLDivElement>) => void;
	onDrop: (event: DragEvent<HTMLDivElement>) => void;
};

export type EditorFileDropOptions = {
	organizationId?: string;
	organizationSlug?: string;
	/** Purpose used for png and jpeg drops. */
	imagePurpose: DropImagePurpose;
	/**
	 * Purpose used for every other file. Without it the surface is image only,
	 * which is the case for a milestone description.
	 */
	filePurpose?: DropFilePurpose;
	/** True while the host cannot accept files, for example during a save. */
	disabled?: boolean;
	/** Lets the host disable Post or Save while an upload runs. */
	onUploadingChange?: (uploading: boolean) => void;
};

/** True when the dragged payload contains OS files. */
function hasFiles(event: DragEvent<HTMLElement>): boolean {
	const types = event.dataTransfer?.types;

	if (!types) return false;

	// `types` is a DOMStringList in older browsers and an array in modern ones,
	// so `Array.from` is the portable read.
	return Array.from(types).includes("Files");
}

/** True when the file should be treated as an image. */
function isImageFile(file: File): boolean {
	if (file.type.startsWith("image/")) return true;

	// Some platforms report an empty MIME type for a perfectly ordinary image.
	return /\.(png|jpe?g)$/i.test(file.name);
}

/** The upload purpose a dropped file should use. */
function pickPurpose(
	file: File,
	imagePurpose: DropImagePurpose,
	filePurpose?: DropFilePurpose,
): UploadPurpose {
	if (isImageFile(file) || !filePurpose) return imagePurpose;

	return filePurpose;
}

/**
 * Insert a visible target while a file hovers the editor.
 *
 * Without it the browser shows a droppable cursor over a surface that used to
 * do nothing, which is exactly the confusion this feature fixes. The layer is
 * decorative and never intercepts the pointer or the drop.
 */
export function EditorDropOverlay({
	visible,
	label,
}: {
	visible: boolean;
	label: string;
}) {
	if (!visible) return null;

	return (
		<div
			aria-hidden
			className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center border-2 border-dashed border-app-focus bg-app-canvas/80"
		>
			<span className="border border-app-focus bg-app-panel px-3 py-1.5 text-xs font-medium text-app-text">
				{label}
			</span>
		</div>
	);
}

export function useEditorFileDrop(
	editor: PlateEditor,
	{
		organizationId,
		organizationSlug,
		imagePurpose,
		filePurpose,
		disabled = false,
		onUploadingChange,
	}: EditorFileDropOptions,
): {
	dropProps: EditorDropProps;
	isDragging: boolean;
} {
	const [isDragging, setIsDragging] = useState(false);

	// The hook is inert without a tenant, because every upload policy is
	// organization scoped. Read only surfaces never register the handlers.
	const enabled = !disabled && Boolean(organizationId && organizationSlug);

	/**
	 * Upload every accepted file and insert it at the captured point.
	 *
	 * Insertion happens one file at a time, after its own upload, so the order
	 * in the editor matches the order in the drop. Images land as blocks, the
	 * documents land as inline chips, and each insert advances the point used
	 * by the next file.
	 */
	async function handleFiles(
		files: File[],
		range: TRange | null,
	): Promise<void> {
		if (!organizationId || !organizationSlug) return;

		// Validate before starting the guard and the progress toasts, so a drop
		// of unsupported files never looks like it began an upload.
		const accepted: { file: File; purpose: UploadPurpose }[] = [];

		for (const file of files) {
			const purpose = pickPurpose(file, imagePurpose, filePurpose);
			const problem = validateUploadFile(file, purpose);

			if (problem) {
				toast.error(`${file.name}: ${problem}`);
				continue;
			}

			accepted.push({ file, purpose });
		}

		if (accepted.length === 0) return;

		// Why the label: the switch guard shows this reason in the blocked
		// dialog, so it must describe what the person would interrupt.
		const reason =
			accepted.length > 1
				? `Uploading ${String(accepted.length)} files`
				: accepted[0]?.purpose === imagePurpose
					? "Uploading an image"
					: "Uploading a file";

		// Images stay block nodes, so they need the top level block point. An
		// attachment is inline, so it uses the text range instead. Both advance
		// after each insert so a mixed drop keeps its order.
		let blockPoint = range
			? resolveInsertPoint(editor, range)
			: resolveInsertPoint(editor);
		let inlineRange = range;

		// A storage disabled browser throws on the guard write. Keeping the
		// handle optional means the upload still runs and still releases the
		// composer in the finally block.
		let operation: ReturnType<typeof beginOrganizationOperation> | null = null;

		onUploadingChange?.(true);

		try {
			operation = beginOrganizationOperation({
				organizationId,
				organizationSlug,
				reason,
			});
		} catch {
			// A browser with storage disabled cannot record the guard. The upload
			// still has to run, so the failed safety net must not stop it.
		}

		try {
			for (const { file, purpose } of accepted) {
				const toastId = toast.loading(`Uploading ${file.name}...`);

				try {
					const uploaded = await uploadFile({
						file,
						purpose,
						organizationId,
						onProgress: (percent) => {
							toast.loading(`Uploading ${file.name} ${String(percent)}%`, {
								id: toastId,
							});
						},
					});

					const node =
						purpose === imagePurpose
							? imageNode(uploaded.url, file.name)
							: fileNode(uploaded.url, file);

					if (purpose === imagePurpose) {
						const insertedAt = insertVoidBlock(editor, blockPoint, node);
						blockPoint = {
							at: PathApi.next(insertedAt),
							replaceEmpty: false,
						};
						// The drop range points at the block before the new image,
						// so later attachments follow the caret below it instead.
						inlineRange = null;
					} else {
						// The first chip uses the drop point. After that the caret sits
						// right behind the previous chip, so the next one is inserted
						// there instead of at the original pointer position.
						insertInlineNode(editor, inlineRange, node);
						inlineRange = null;
					}

					toast.success(
						purpose === imagePurpose ? "Image added." : "File added.",
						{ id: toastId },
					);
				} catch (error) {
					toast.error(
						error instanceof Error
							? error.message
							: "Could not upload the file.",
						{ id: toastId },
					);
				}
			}
		} finally {
			operation?.end();
			onUploadingChange?.(false);
		}
	}

	function handleDragEnter(event: DragEvent<HTMLDivElement>): void {
		if (!enabled || !hasFiles(event)) return;

		// Claiming the drag is what allows the drop. Without preventDefault the
		// browser may open the file instead of handing it to the page.
		event.preventDefault();
		setIsDragging(true);
	}

	function handleDragOver(event: DragEvent<HTMLDivElement>): void {
		if (!enabled || !hasFiles(event)) return;

		event.preventDefault();

		if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
	}

	function handleDragLeave(event: DragEvent<HTMLDivElement>): void {
		// Moving across a child node fires leave on the parent first. Only a
		// leave whose new target is outside the editor ends the drag. The file
		// check is deliberately absent here, because some browsers report an
		// empty type list on the leave event and the overlay would stay stuck.
		const next = event.relatedTarget;

		if (next instanceof Node && event.currentTarget.contains(next)) return;

		setIsDragging(false);
	}

	function handleDrop(event: DragEvent<HTMLDivElement>): void {
		if (!enabled) return;

		const files = Array.from(event.dataTransfer?.files ?? []);

		setIsDragging(false);

		// Not a file drop, so Slate and react-dnd keep their normal handling.
		if (files.length === 0) return;

		// Must run before the async upload begins. It stops Slate from running
		// its own drop handler, which would swallow the event and insert
		// nothing, and it stops the browser from navigating to the file.
		event.preventDefault();
		event.stopPropagation();

		const range = editor.api.findEventRange(event.nativeEvent) ?? null;

		void handleFiles(files, range);
	}

	return {
		dropProps: {
			onDragEnter: handleDragEnter,
			onDragOver: handleDragOver,
			onDragLeave: handleDragLeave,
			onDrop: handleDrop,
		},
		isDragging: enabled && isDragging,
	};
}
