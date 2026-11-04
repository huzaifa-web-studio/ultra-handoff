"use client";

/**
 * The icon and colour for a file format.
 *
 * Why a dedicated file-format icon set for some types: Lucide is a general UI
 * set and has no PDF, CSV, text or ZIP glyph. `@react-symbols/icons` ships the
 * real format glyphs, so PDF and CSV look like PDF and CSV instead of a generic
 * document. Excel and PowerPoint keep their Lucide glyphs because that icon set
 * has no Office files, and the two are already unambiguous there.
 *
 * The file name is always rendered next to the icon, so the icon itself is
 * decorative for a screen reader.
 *
 * Used by: features/milestones/editor/editor-file.tsx and
 * features/files/file-viewer-dialog.tsx.
 */

import {
	Csv,
	Image as ImageFile,
	PDF,
	Text as TextFile,
	Zip,
} from "@react-symbols/icons/files";
import { cn } from "cn";
import {
	FileIcon,
	FilePenIcon,
	FileSpreadsheetIcon,
	PresentationIcon,
} from "lucide-react";
import type { ComponentType } from "react";

/** Colour families available for a file type. */
type FileTone = "danger" | "info" | "success" | "warning" | "neutral";

type FileVisual = {
	Icon: ComponentType<{ className?: string }>;
	tone: FileTone;
};

/**
 * Text colour per tone.
 *
 * Written as full class strings, never concatenated, so Tailwind generates all
 * of them. The Symbols icons carry their own colours, so this only colours the
 * Lucide glyphs.
 */
const TONE_CLASSES: Record<FileTone, string> = {
	danger: "text-danger",
	info: "text-info",
	success: "text-success",
	warning: "text-warning",
	neutral: "text-neutral",
};

/** Lowercase extension without the dot, or an empty string. */
function extensionOf(name: string): string {
	const index = name.lastIndexOf(".");

	return index >= 0 ? name.slice(index + 1).toLowerCase() : "";
}

/**
 * Choose an icon and tone for a file.
 *
 * The MIME type is checked first, with the extension as the fallback for the
 * platforms that report an empty or generic type.
 */
export function fileVisualFor(file: {
	name: string;
	mime: string;
}): FileVisual {
	const mime = file.mime.split(";")[0]?.trim().toLowerCase() ?? "";
	const extension = extensionOf(file.name);

	if (mime === "application/pdf" || extension === "pdf") {
		return { Icon: PDF, tone: "danger" };
	}

	if (mime === "text/csv" || extension === "csv") {
		return { Icon: Csv, tone: "success" };
	}

	if (
		mime.includes("spreadsheet") ||
		mime.includes("excel") ||
		extension === "xls" ||
		extension === "xlsx"
	) {
		return { Icon: FileSpreadsheetIcon, tone: "success" };
	}

	if (
		mime.includes("presentation") ||
		mime.includes("powerpoint") ||
		extension === "ppt" ||
		extension === "pptx"
	) {
		return { Icon: PresentationIcon, tone: "warning" };
	}

	if (
		mime.includes("zip") ||
		mime.includes("compressed") ||
		extension === "zip"
	) {
		return { Icon: Zip, tone: "neutral" };
	}

	if (mime.startsWith("image/")) {
		return { Icon: ImageFile, tone: "info" };
	}

	if (
		mime.includes("word") ||
		mime.includes("document") ||
		extension === "doc" ||
		extension === "docx"
	) {
		return { Icon: FilePenIcon, tone: "info" };
	}

	if (mime.startsWith("text/") || extension === "txt") {
		return { Icon: TextFile, tone: "neutral" };
	}

	return { Icon: FileIcon, tone: "neutral" };
}

/** Sizes the icon is used at. */
const ICON_SIZE = {
	sm: "size-5",
	md: "size-8",
	lg: "size-10",
} as const;

/** The file format icon, sized for the chip, the dialog header or an empty state. */
export function FileTypeIcon({
	name,
	mime,
	size = "sm",
	className,
}: {
	name: string;
	mime: string;
	size?: keyof typeof ICON_SIZE;
	className?: string;
}) {
	const { Icon, tone } = fileVisualFor({ name, mime });

	return (
		<span
			aria-hidden
			className={cn(
				"flex shrink-0 items-center justify-center",
				ICON_SIZE[size],
				TONE_CLASSES[tone],
				className,
			)}
		>
			<Icon className="size-full" />
		</span>
	);
}
