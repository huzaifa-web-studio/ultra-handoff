"use client";

/**
 * The fixed formatting toolbar at the bottom of the comment composer.
 *
 * Why fixed instead of a selection floating bar: the composer is short and the
 * toolbar doubles as the action row, so the controls are visible before the
 * writer has typed anything. That is the discoverability trade the product
 * asked for, and it keeps the focus on the send action at the bottom edge.
 *
 * Everything a comment can contain is reachable from here: text style, marks,
 * lists and checklists, a table, an uploaded image, an uploaded document and a
 * link. Images and files use the same presigned pipeline as the milestone
 * editor, so the browser still uploads straight to storage and the API only
 * verifies the object.
 *
 * Must be rendered inside the Plate provider: the buttons read the current
 * selection and insert at it.
 *
 * Used by: comments/comment-composer.tsx and comments/comment-item.tsx.
 */

import { triggerFloatingLinkInsert } from "@platejs/link/react";
import {
	BoldIcon,
	CodeIcon,
	ImageIcon,
	ItalicIcon,
	LinkIcon,
	ListIcon,
	ListOrderedIcon,
	ListTodoIcon,
	PaperclipIcon,
	StrikethroughIcon,
	TableIcon,
	UnderlineIcon,
} from "lucide-react";
import { useEditorRef } from "platejs/react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { beginOrganizationOperation } from "#/features/organization/switch-guard";
import {
	FILE_POLICIES,
	type UploadPurpose,
	uploadFile,
	validateUploadFile,
} from "#/lib/upload";
import { fileNode, imageNode } from "../../editor/editor-nodes";
import {
	BlockSelect,
	ListButton,
	MarkButton,
	ToolbarButton,
	ToolbarSeparator,
} from "../../editor/editor-toolbar-primitives";
import {
	type CommentInsertPoint,
	insertCommentBlock,
	insertCommentTable,
	resolveCommentInsertPoint,
} from "./comment-insert";

export function CommentToolbar({
	organizationId,
	organizationSlug,
	onUploadingChange,
}: {
	organizationId: string;
	organizationSlug: string;
	/**
	 * Lets the host disable Post or Save while a file is still uploading, so a
	 * message cannot be sent without the attachment the writer just picked.
	 */
	onUploadingChange?: (uploading: boolean) => void;
}) {
	const editor = useEditorRef();
	const imageInputRef = useRef<HTMLInputElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	// The selection is captured before the picker steals focus, so the node lands
	// where the writer left the caret even after a long upload.
	const pointRef = useRef<CommentInsertPoint | null>(null);
	const [uploading, setUploading] = useState<"image" | "file" | null>(null);

	const canUpload =
		Boolean(organizationId) && Boolean(organizationSlug) && uploading === null;

	function pickImage() {
		pointRef.current = resolveCommentInsertPoint(editor);
		imageInputRef.current?.click();
	}

	function pickFile() {
		pointRef.current = resolveCommentInsertPoint(editor);
		fileInputRef.current?.click();
	}

	/**
	 * Upload one file and insert the matching node.
	 *
	 * The organization guard is used for the same reason as the milestone
	 * editor: a slow upload must not be interrupted by a workspace switch
	 * without telling the person what is happening.
	 */
	async function upload(
		file: File,
		purpose: Extract<UploadPurpose, "comment-image" | "comment-file">,
	) {
		if (!organizationId || !organizationSlug) return;

		const problem = validateUploadFile(file, purpose);

		if (problem) {
			toast.error(problem);
			return;
		}

		const kind = purpose === "comment-image" ? "image" : "file";
		const toastId = toast.loading(
			kind === "image" ? "Uploading image..." : "Uploading file...",
		);

		// The guard write can fail on a browser with storage disabled. Keeping
		// the operation optional means a failure still lands in the catch and
		// still releases the composer.
		let operation: ReturnType<typeof beginOrganizationOperation> | null = null;

		try {
			operation = beginOrganizationOperation({
				organizationId,
				organizationSlug,
				reason:
					kind === "image"
						? "Uploading a comment image"
						: "Uploading a comment file",
			});

			setUploading(kind);
			onUploadingChange?.(true);

			const uploaded = await uploadFile({
				file,
				purpose,
				organizationId,
				onProgress: (percent) => {
					toast.loading(
						kind === "image"
							? `Uploading image ${percent}%`
							: `Uploading file ${percent}%`,
						{ id: toastId },
					);
				},
			});

			const point = pointRef.current ?? resolveCommentInsertPoint(editor);

			if (purpose === "comment-image") {
				insertCommentBlock(editor, point, imageNode(uploaded.url, file.name));
			} else {
				insertCommentBlock(editor, point, fileNode(uploaded.url, file));
			}

			toast.success(kind === "image" ? "Image added." : "File added.", {
				id: toastId,
			});
		} catch (error) {
			toast.error(
				error instanceof Error
					? error.message
					: kind === "image"
						? "Could not upload the image."
						: "Could not upload the file.",
				{ id: toastId },
			);
		} finally {
			operation?.end();
			setUploading(null);
			onUploadingChange?.(false);
			pointRef.current = null;
		}
	}

	return (
		<>
			<div
				role="toolbar"
				aria-label="Comment formatting"
				className="flex flex-wrap items-center gap-0.5"
			>
				<BlockSelect />

				<ToolbarSeparator />

				<MarkButton mark="bold" label="Bold">
					<BoldIcon aria-hidden />
				</MarkButton>
				<MarkButton mark="italic" label="Italic">
					<ItalicIcon aria-hidden />
				</MarkButton>
				<MarkButton mark="underline" label="Underline">
					<UnderlineIcon aria-hidden />
				</MarkButton>
				<MarkButton mark="strikethrough" label="Strikethrough">
					<StrikethroughIcon aria-hidden />
				</MarkButton>
				<MarkButton mark="code" label="Inline code">
					<CodeIcon aria-hidden />
				</MarkButton>

				<ToolbarSeparator />

				<ListButton list="ul" label="Bulleted list">
					<ListIcon aria-hidden />
				</ListButton>
				<ListButton list="ol" label="Numbered list">
					<ListOrderedIcon aria-hidden />
				</ListButton>
				<ListButton list="taskList" label="Checklist">
					<ListTodoIcon aria-hidden />
				</ListButton>

				<ToolbarSeparator />

				<ToolbarButton
					label="Insert table"
					disabled={uploading !== null}
					onPress={() =>
						insertCommentTable(editor, resolveCommentInsertPoint(editor))
					}
				>
					<TableIcon aria-hidden />
				</ToolbarButton>

				<ToolbarButton
					label="Upload image"
					disabled={!canUpload}
					onPress={pickImage}
				>
					<ImageIcon aria-hidden />
				</ToolbarButton>

				<ToolbarButton
					label="Attach file"
					disabled={!canUpload}
					onPress={pickFile}
				>
					<PaperclipIcon aria-hidden />
				</ToolbarButton>

				<ToolbarSeparator />

				<ToolbarButton
					label="Link"
					onPress={() => triggerFloatingLinkInsert(editor, { focused: true })}
				>
					<LinkIcon aria-hidden />
				</ToolbarButton>
			</div>

			<input
				ref={imageInputRef}
				type="file"
				accept={FILE_POLICIES["comment-image"].accept}
				aria-hidden
				tabIndex={-1}
				className="hidden"
				onChange={(event) => {
					const file = event.target.files?.[0];
					// Reset first, so picking the same file twice still fires.
					event.target.value = "";
					if (file) void upload(file, "comment-image");
				}}
			/>

			<input
				ref={fileInputRef}
				type="file"
				accept={FILE_POLICIES["comment-file"].accept}
				aria-hidden
				tabIndex={-1}
				className="hidden"
				onChange={(event) => {
					const file = event.target.files?.[0];
					event.target.value = "";
					if (file) void upload(file, "comment-file");
				}}
			/>
		</>
	);
}
