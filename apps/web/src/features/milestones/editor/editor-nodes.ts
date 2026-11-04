"use client";

/**
 * Node builders for uploaded images and attachments.
 *
 * Why this module: the comment toolbar picks a file and the file drop handler
 * receives one, but both must produce exactly the same node shape, otherwise a
 * dropped file would render differently from a picked one. The API sanitizer
 * accepts only the fields built here, so this stays the single definition.
 *
 * Used by: editor-file-drop.tsx and comments/editor/comment-toolbar.tsx.
 */

import { KEYS, type TElement } from "platejs";

/** The MIME string stored on an attachment card. */
export function displayMime(file: File): string {
	const declared = file.type.split(";")[0]?.trim().toLowerCase();

	return declared && declared.length > 0
		? declared
		: "application/octet-stream";
}

/** A safe default alt text from the original filename. */
export function imageAltFromName(name: string): string {
	return (
		name
			.replace(/\.[^.]+$/, "")
			.trim()
			.slice(0, 200) || "Image"
	);
}

/** An uploaded image block. */
export function imageNode(url: string, fileName: string): TElement {
	return {
		type: KEYS.img,
		url,
		alt: imageAltFromName(fileName),
		children: [{ text: "" }],
	};
}

/** An uploaded attachment block. */
export function fileNode(url: string, file: File): TElement {
	return {
		type: "file",
		url,
		name: file.name.slice(0, 200),
		mime: displayMime(file),
		size: file.size,
		children: [{ text: "" }],
	};
}
