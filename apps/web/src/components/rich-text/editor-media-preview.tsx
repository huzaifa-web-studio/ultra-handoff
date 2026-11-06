"use client";

/**
 * The official image preview dialog.
 *
 * Why this exists: double clicking an image should open a full screen view
 * without leaving the milestone. The overlay, zoom, paging and download logic
 * come from `@platejs/media/react`; only the colours are adapted to the app so
 * the lightbox reads as part of the product instead of a second theme.
 *
 * The URLs in the preview store are resolved before they are stored, because
 * uploads are relative to the API origin rather than the web origin.
 *
 * Used by: features/milestones/editor/editor-kit.tsx.
 */

import {
	PreviewImage,
	useImagePreview,
	useImagePreviewValue,
	useScaleInput,
} from "@platejs/media/react";
import { cn } from "cn";
import {
	ArrowLeftIcon,
	ArrowRightIcon,
	DownloadIcon,
	MinusIcon,
	PlusIcon,
	XIcon,
} from "lucide-react";
import { useEditorRef } from "platejs/react";
import type { ComponentProps } from "react";

/** How many pixels one wheel or keyboard step scrolls the zoom. */
const SCROLL_SPEED = 4;

/** Fallback name when the URL has no readable last segment. */
const DEFAULT_DOWNLOAD_FILENAME = "image";

/** A square control that stays legible on the dark overlay. */
function PreviewButton({
	className,
	disabled,
	...props
}: ComponentProps<"button">) {
	return (
		<button
			type="button"
			disabled={disabled}
			className={cn(
				"inline-flex size-8 items-center justify-center transition-colors",
				disabled
					? "cursor-not-allowed text-ivory/40"
					: "text-ivory hover:bg-ivory/10",
				className,
			)}
			{...props}
		/>
	);
}

export function MediaPreviewDialog() {
	const editor = useEditorRef();
	const isOpen = useImagePreviewValue("isOpen", editor.id);
	const scale = useImagePreviewValue("scale");
	const isEditingScale = useImagePreviewValue("isEditingScale");
	const currentPreview = useImagePreviewValue("currentPreview");
	const {
		closeProps,
		currentUrlIndex,
		maskLayerProps,
		nextDisabled,
		nextProps,
		prevDisabled,
		prevProps,
		scaleTextProps,
		zommOutProps,
		zoomInDisabled,
		zoomInProps,
		zoomOutDisabled,
	} = useImagePreview({ scrollSpeed: SCROLL_SPEED });

	const downloadUrl = getImageDownloadUrl(currentPreview?.url);
	const downloadDisabled = !downloadUrl;

	function handleDownload() {
		if (!downloadUrl) return;

		const link = document.createElement("a");
		link.download = getImageDownloadFilename(downloadUrl);
		link.href = downloadUrl;
		link.rel = "noopener noreferrer";
		document.body.append(link);
		link.click();
		link.remove();
	}

	return (
		<div
			className={cn("fixed inset-0 z-50 select-none", !isOpen && "hidden")}
			role="dialog"
			aria-modal="true"
			aria-label="Image preview"
			aria-hidden={!isOpen}
		>
			<button
				type="button"
				aria-label="Close image preview"
				className="absolute inset-0 bg-graphite/90"
				onContextMenu={(event) => event.stopPropagation()}
				{...maskLayerProps}
			/>

			<div className="absolute inset-0 flex items-center justify-center">
				<div className="relative flex max-h-screen w-full items-center">
					<PreviewImage className="mx-auto block max-h-[calc(100vh-4rem)] w-auto object-contain transition-transform" />

					<div
						className="-translate-x-1/2 absolute bottom-0 left-1/2 z-40 flex w-fit items-center justify-center gap-3 bg-graphite/80 p-2 text-ivory"
						role="toolbar"
						aria-label="Image preview controls"
					>
						<div className="flex items-center gap-1">
							<PreviewButton
								aria-label="Previous image"
								{...prevProps}
								disabled={prevDisabled}
							>
								<ArrowLeftIcon className="size-4" aria-hidden />
							</PreviewButton>

							<span className="min-w-6 text-center text-xs tabular-nums">
								{(currentUrlIndex ?? 0) + 1}
							</span>

							<PreviewButton
								aria-label="Next image"
								{...nextProps}
								disabled={nextDisabled}
							>
								<ArrowRightIcon className="size-4" aria-hidden />
							</PreviewButton>
						</div>

						<div className="flex items-center gap-1">
							<PreviewButton
								aria-label="Zoom out"
								{...zommOutProps}
								disabled={zoomOutDisabled}
							>
								<MinusIcon className="size-4" aria-hidden />
							</PreviewButton>

							{isEditingScale ? (
								<span className="flex items-center gap-1 text-xs">
									<ScaleInput className="w-10 bg-transparent px-1 text-center text-ivory outline-none" />
									<span>%</span>
								</span>
							) : (
								<button
									type="button"
									className="min-w-12 text-center text-xs tabular-nums"
									{...scaleTextProps}
								>
									{`${scale * 100}%`}
								</button>
							)}

							<PreviewButton
								aria-label="Zoom in"
								{...zoomInProps}
								disabled={zoomInDisabled}
							>
								<PlusIcon className="size-4" aria-hidden />
							</PreviewButton>
						</div>

						<PreviewButton
							aria-label="Download image"
							disabled={downloadDisabled}
							onClick={handleDownload}
						>
							<DownloadIcon className="size-4" aria-hidden />
						</PreviewButton>

						<PreviewButton aria-label="Close image preview" {...closeProps}>
							<XIcon className="size-4" aria-hidden />
						</PreviewButton>
					</div>
				</div>
			</div>
		</div>
	);
}

/** The editable zoom value shown next to the percentage. */
function ScaleInput(props: ComponentProps<"input">) {
	const { props: scaleInputProps, ref } = useScaleInput();

	return <input {...scaleInputProps} {...props} ref={ref} />;
}

/** Read the download filename from the URL path. */
function getImageDownloadFilename(url: string): string {
	try {
		const pathname = new URL(url, window.location.href).pathname;
		const filename = pathname.split("/").filter(Boolean).pop();

		return filename || DEFAULT_DOWNLOAD_FILENAME;
	} catch {
		return DEFAULT_DOWNLOAD_FILENAME;
	}
}

/** Only direct web, blob or image data URLs may be downloaded. */
function getImageDownloadUrl(url: string | undefined): string | null {
	if (!url) return null;

	try {
		const parsed = new URL(url, "https://plate.invalid");

		if (
			["http:", "https:", "blob:"].includes(parsed.protocol) ||
			(parsed.protocol === "data:" &&
				parsed.pathname.toLowerCase().startsWith("image/"))
		) {
			return url;
		}
	} catch {
		return null;
	}

	return null;
}
