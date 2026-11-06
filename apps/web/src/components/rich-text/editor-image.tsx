"use client";

/**
 * Image node renderers.
 *
 * Why the official media node: images are the one rich text feature that
 * benefits from Plate's maintained media behaviour, so the upload, resize and
 * caption primitives come from `@platejs/media`, `@platejs/caption` and
 * `@platejs/resizable` instead of a bespoke node.
 *
 * What is adapted: the registry example assumes Radix popovers and the Plate UI
 * token set. This file keeps the same node behaviour, the same stored fields
 * and the app's design tokens, and exposes the caption by selecting the image
 * instead of opening a floating toolbar.
 *
 * Stored shape stays small and portable:
 *   { type: "img", url, alt?, width?, caption?, children: [{ text: "" }] }
 *
 * Used by: features/milestones/editor/editor-kit.tsx and
 * features/milestones/editor/milestone-editor.tsx (read only render).
 */

import { Button } from "@org/ui/components/button";
import { CaptionTextarea } from "@platejs/caption/react";
import { ImagePreviewStore, useMediaState } from "@platejs/media/react";
import {
	Resizable as ResizablePrimitive,
	ResizableProvider,
	type ResizeHandle as ResizeHandlePrimitive,
	useResizableValue,
	useResizeHandle,
	useResizeHandleState,
} from "@platejs/resizable";
import { cn } from "cn";
import { Trash2Icon } from "lucide-react";
import {
	KEYS,
	NodeApi,
	type SlateEditor,
	type TCaptionProps,
	type TImageElement,
	type TResizableProps,
} from "platejs";
import {
	PlateElement,
	type PlateElementProps,
	useEditorRef,
	useReadOnly,
	useRemoveNodeButton,
	useSelected,
	withHOC,
} from "platejs/react";
import { SlateElement, type SlateElementProps } from "platejs/static";
import type { ComponentProps } from "react";

import { resolveAssetUrl } from "#/lib/files";
import {
	BlockSideIndicator,
	beginBlockSide,
	clearBlockSide,
} from "./editor-block-side";

/** The image node plus the fields the media, caption and resize plugins add. */
type MilestoneImageElement = TImageElement & TCaptionProps & TResizableProps;

/** The alignment options the resize wrapper understands. */
type ImageAlign = NonNullable<TResizableProps["align"]>;

/** Shared alignment classes for the figure and the caption. */
function alignmentClass(align: ImageAlign): string {
	if (align === "left") return "mr-auto";
	if (align === "right") return "ml-auto";

	return "mx-auto";
}

/** Alt text, including the value the HTML parser stores in attributes. */
function imageAlt(element: MilestoneImageElement): string {
	if (typeof element.alt === "string") return element.alt;

	const attributes = (element as { attributes?: { alt?: unknown } }).attributes;
	return typeof attributes?.alt === "string" ? attributes.alt : "";
}

/**
 * A resize handle styled for the app.
 *
 * The primitive owns pointer capture, touch handling and the width maths. Only
 * the visible bar and cursor are ours, so the handle looks native to the
 * editor and still behaves exactly like the official one.
 */
function ResizeHandle({
	className,
	options,
	...props
}: ComponentProps<typeof ResizeHandlePrimitive>) {
	const state = useResizeHandleState(options ?? {});
	const handle = useResizeHandle(state);

	if (state.readOnly) return null;

	return (
		<div
			data-block-side-ignore
			className={cn(
				"absolute top-0 z-20 h-full w-5 cursor-col-resize touch-none select-none",
				state.direction === "left" ? "-left-2" : "-right-2",
				"after:absolute after:top-1/2 after:h-14 after:w-[3px] after:-translate-y-1/2 after:rounded-full after:bg-app-focus after:opacity-0 after:transition-opacity after:content-['']",
				"group-hover/image:after:opacity-100 data-[resizing=true]:after:opacity-100",
				className,
			)}
			data-resizing={state.isResizing}
			{...handle.props}
			{...props}
		/>
	);
}

/** The resize wrapper, aligned to the stored image alignment. */
function Resizable({
	align = "center",
	className,
	...props
}: ComponentProps<typeof ResizablePrimitive> & { align?: ImageAlign }) {
	return (
		<ResizablePrimitive
			{...props}
			className={cn(alignmentClass(align), className)}
		/>
	);
}

/**
 * Open the official preview dialog with URLs the browser can actually load.
 *
 * Stored image URLs are relative to the API origin, so the preview list is
 * resolved before it is handed to the media store. The dialog itself stays the
 * official component.
 */
function openImagePreview(editor: SlateEditor, element: MilestoneImageElement) {
	const previewList = Array.from(
		editor.api.nodes({
			at: [],
			match: (node) => "type" in node && node.type === KEYS.img,
		}),
		([node]) => {
			const image = node as MilestoneImageElement;
			return {
				id: image.id,
				url: resolveAssetUrl(image.url) ?? "",
			};
		},
	).filter((item) => item.url.length > 0);

	const url = resolveAssetUrl(element.url);
	if (!url) return;

	ImagePreviewStore.set("openEditorId", editor.id);
	ImagePreviewStore.set("currentPreview", { id: element.id, url });
	ImagePreviewStore.set("previewList", previewList);
}

/**
 * An image in the editable body.
 *
 * The caption field is hidden until the image is selected or a caption exists.
 * Selecting the image is the same affordance as the official toolbar's Caption
 * button, and it avoids mounting a second popover inside the block gutter.
 */
export const ImageElement = withHOC(
	ResizableProvider,
	function ImageElement(props: PlateElementProps<TImageElement>) {
		const element = props.element as MilestoneImageElement;
		const editor = useEditorRef();
		const readOnly = useReadOnly();
		const selected = useSelected();
		const { align = "center" } = useMediaState();
		const width = useResizableValue("width");
		const remove = useRemoveNodeButton({ element });
		const src = resolveAssetUrl(element.url);
		const alt = imageAlt(element);

		// A document written by an older build can carry an unusable URL. The
		// sanitizer drops those, so this is only a defensive fallback.
		if (!src) {
			return (
				<PlateElement
					{...props}
					as="div"
					className={cn("my-1", props.className)}
				/>
			);
		}

		return (
			<PlateElement
				{...props}
				className={cn("relative my-3", props.className)}
				attributes={{
					...props.attributes,
					onMouseDown: (event) => {
						if (!beginBlockSide(editor, props.element, event, 24)) {
							clearBlockSide(editor);
						}
					},
				}}
			>
				<BlockSideIndicator element={props.element} />

				<figure contentEditable={false} className="group/image relative m-0">
					<Resizable align={align} options={{ align, readOnly }}>
						<ResizeHandle options={{ direction: "left" }} />

						<img
							src={src}
							alt={alt}
							loading="lazy"
							draggable={false}
							onDoubleClick={
								readOnly ? undefined : () => openImagePreview(editor, element)
							}
							className={cn(
								"block h-auto w-full max-w-full cursor-pointer border border-app-border bg-app-panel-subtle object-contain",
								selected && "ring-2 ring-app-focus ring-offset-2",
							)}
						/>

						<ResizeHandle options={{ direction: "right" }} />
					</Resizable>

					{/*
					 * Always rendered, never gated on selection.
					 *
					 * The official `Caption` component hides itself until the
					 * image is selected, which made the field appear only
					 * after the click that selected the image. The writer then
					 * had to click a second time, and often the focus landed
					 * on the block instead. A permanently mounted field can be
					 * clicked once and focused immediately.
					 *
					 * The remove button is deliberately rendered after this
					 * field. When it sat before the caption, selecting or
					 * deselecting the image added or removed a sibling ahead
					 * of the textarea, React remounted the textarea, and the
					 * caret was lost. Keeping the caption at a stable position
					 * is what lets it keep focus while the image deselects.
					 */}
					{!readOnly && (
						<figcaption
							key="caption"
							data-block-side-ignore
							style={{ width }}
							className={cn(
								"mt-2 max-w-full",
								alignmentClass(align),
								align === "left"
									? "text-left"
									: align === "right"
										? "text-right"
										: "text-center",
							)}
						>
							<CaptionTextarea
								readOnly={readOnly}
								aria-label="Image caption"
								placeholder="Add a caption..."
								onMouseDown={(event) => event.stopPropagation()}
								onClick={(event) => event.stopPropagation()}
								className="w-full resize-none border-0 bg-transparent p-0 text-xs text-app-text-muted outline-none placeholder:text-app-text-muted/70"
							/>
						</figcaption>
					)}

					{!readOnly && selected && (
						<Button
							key="remove"
							{...remove.props}
							type="button"
							variant="surface"
							size="icon-xs"
							aria-label="Remove image"
							className="absolute top-1 right-1 z-30"
						>
							<Trash2Icon aria-hidden />
						</Button>
					)}
				</figure>

				{props.children}
			</PlateElement>
		);
	},
);

/**
 * An image in the read only render.
 *
 * The static path has no editor, so the stored width and caption are applied
 * directly and no handles are mounted. This mirrors the official static media
 * kit and keeps clients from receiving editor only controls.
 */
export function ImageElementStatic(
	props: SlateElementProps<TImageElement & TCaptionProps & TResizableProps>,
) {
	const element = props.element;
	const align = element.align ?? "center";
	const src = resolveAssetUrl(element.url);
	const alt = imageAlt(element);
	const captionNode = element.caption?.[0];
	const caption = captionNode ? NodeApi.string(captionNode) : "";
	const width =
		typeof element.width === "number" ? `${element.width}px` : "100%";

	if (!src) {
		return <SlateElement {...props} as="div" className={props.className} />;
	}

	return (
		<SlateElement {...props} className={cn("my-3", props.className)}>
			<figure
				contentEditable={false}
				className={cn("m-0 max-w-full", alignmentClass(align))}
				style={{ width }}
			>
				<img
					src={src}
					alt={alt}
					loading="lazy"
					className="block h-auto w-full max-w-full border border-app-border bg-app-panel-subtle object-contain"
				/>

				{caption.length > 0 && (
					<figcaption
						className={cn(
							"mt-2 max-w-full text-xs text-app-text-muted",
							align === "left"
								? "text-left"
								: align === "right"
									? "text-right"
									: "text-center",
						)}
					>
						{caption}
					</figcaption>
				)}
			</figure>

			{props.children}
		</SlateElement>
	);
}
