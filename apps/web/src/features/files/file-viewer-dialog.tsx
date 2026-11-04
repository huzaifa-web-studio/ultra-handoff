"use client";

/**
 * The attachment viewer dialog.
 *
 * Why a dialog instead of a new tab: the attachment belongs to a milestone or a
 * discussion, so reading it without losing the page is the point. Download stays
 * one click away for the full file or for a type that cannot be previewed.
 *
 * The heavy viewers are imported only when their kind is opened. PDF, Word and
 * Excel libraries never enter the main bundle, so a person who never opens an
 * attachment pays nothing for them.
 *
 * Used by: features/milestones/editor/editor-file.tsx.
 */

import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@org/ui/components/dialog";
import { DownloadIcon, FileIcon } from "lucide-react";
import { type ComponentType, useEffect, useState } from "react";

import { fileDownloadUrl } from "./download-url";
import { formatFileSize } from "./format";
import { type ViewerKind, viewerKindFor } from "./viewer-kind";
import type { ViewerProps } from "./viewer-types";
import CsvViewer from "./viewers/csv-viewer";
import TextViewer from "./viewers/text-viewer";
import { ViewerMessage } from "./viewers/viewer-message";

/** The values the chip already stores on the file node. */
export type ViewerFile = {
	name: string;
	mime: string;
	size?: number;
	/** Absolute URL, resolved from the stored `/files/...` path. */
	src: string;
};

/** Viewers that pull a large dependency, loaded on first use. */
const LAZY_VIEWERS: Partial<
	Record<ViewerKind, () => Promise<{ default: ComponentType<ViewerProps> }>>
> = {
	pdf: () => import("./viewers/pdf-viewer"),
	docx: () => import("./viewers/docx-viewer"),
	sheet: () => import("./viewers/sheet-viewer"),
};

/** The footer download link, styled as a secondary action. */
function DownloadLink({ src, name }: { src: string; name: string }) {
	return (
		<a
			href={fileDownloadUrl(src)}
			className="inline-flex h-8 items-center justify-center gap-2 border border-app-border bg-app-panel px-3 text-xs font-medium text-app-text transition-colors hover:border-app-focus hover:text-app-focus"
		>
			<DownloadIcon className="size-4" aria-hidden />
			Download
			<span className="sr-only">{name}</span>
		</a>
	);
}

/** An image attachment, kept for completeness even though the policy is images only. */
function ImagePreview({ src, name }: ViewerProps) {
	return (
		<div className="flex h-full items-center justify-center overflow-auto bg-app-panel-subtle p-4">
			<img
				src={src}
				alt={name}
				className="max-h-full max-w-full object-contain"
			/>
		</div>
	);
}

/** A type the browser cannot render without a dedicated converter. */
function UnsupportedPreview() {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
			<FileIcon className="size-10 text-app-text-muted" aria-hidden />
			<p className="text-sm font-medium text-app-text">
				No preview for this file type
			</p>
			<p className="max-w-sm text-xs text-app-text-muted">
				Download the file to open it in an application that supports it.
			</p>
		</div>
	);
}

export function FileViewerDialog({
	file,
	isOpen,
	onOpenChange,
}: {
	file: ViewerFile;
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const kind = viewerKindFor(file);
	const [Viewer, setViewer] = useState<ComponentType<ViewerProps> | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);

	useEffect(() => {
		if (!isOpen) return;

		const loader = LAZY_VIEWERS[kind];

		setViewer(null);
		setLoadError(null);

		if (!loader) return;

		let cancelled = false;

		loader()
			.then((module) => {
				if (!cancelled) setViewer(() => module.default);
			})
			.catch(() => {
				if (!cancelled) {
					setLoadError(
						"The preview could not be loaded. Download the file instead.",
					);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [isOpen, kind]);

	const meta = [formatFileSize(file.size), file.mime || "Unknown type"]
		.filter(Boolean)
		.join(" · ");

	function renderBody() {
		if (kind === "unsupported") return <UnsupportedPreview />;
		if (kind === "text") return <TextViewer src={file.src} name={file.name} />;
		if (kind === "csv") return <CsvViewer src={file.src} name={file.name} />;
		if (kind === "image")
			return <ImagePreview src={file.src} name={file.name} />;

		if (loadError) {
			return <ViewerMessage tone="error">{loadError}</ViewerMessage>;
		}

		if (!Viewer) return <ViewerMessage>Loading preview...</ViewerMessage>;

		return <Viewer src={file.src} name={file.name} />;
	}

	return (
		<Dialog
			isOpen={isOpen}
			onOpenChange={onOpenChange}
			className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-5xl"
		>
			<DialogHeader className="min-w-0 pr-12">
				<DialogTitle className="truncate normal-case tracking-normal">
					{file.name}
				</DialogTitle>
				<DialogDescription className="truncate">{meta}</DialogDescription>
			</DialogHeader>

			<div className="flex h-[55vh] min-h-0 flex-col overflow-hidden border border-app-border bg-app-panel sm:h-[65vh]">
				{renderBody()}
			</div>

			<DialogFooter className="sm:items-center sm:justify-between">
				<span className="text-xs text-app-text-muted">
					The preview may differ from the original layout.
				</span>
				<DownloadLink src={file.src} name={file.name} />
			</DialogFooter>
		</Dialog>
	);
}
