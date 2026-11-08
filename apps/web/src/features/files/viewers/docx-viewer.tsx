"use client";

/**
 * Word document preview.
 *
 * Why docx-preview: a .docx is a zip of XML, not a browser format. The library
 * converts it to styled HTML on demand, which is the only practical way to show
 * it inside the app without a server side converter.
 *
 * The rendered HTML is untrusted. It is sandboxed after rendering by removing
 * script capable elements, inline event handlers and unsafe link protocols.
 *
 * Used by: features/files/file-viewer-dialog.tsx.
 */

import { useEffect, useRef, useState } from "react";

import type { ViewerProps } from "../viewer-types";
import { ViewerMessage } from "./viewer-message";

type DocxState = "loading" | "ready" | "error";

/** Protocols a rendered document may link to. */
const SAFE_LINK = /^(https?:|mailto:|#|tel:)/i;

/**
 * Strip anything that can execute from the rendered document.
 *
 * docx-preview renders hyperlinks and can carry embedded markup, so the result
 * is treated as hostile even though the file came from a workspace member.
 */
function sanitizeRenderedDocument(container: HTMLElement): void {
	for (const element of container.querySelectorAll(
		"script, iframe, object, embed, link",
	)) {
		element.remove();
	}

	for (const element of container.querySelectorAll("*")) {
		for (const attribute of Array.from(element.attributes)) {
			if (attribute.name.toLowerCase().startsWith("on")) {
				element.removeAttribute(attribute.name);
			}
		}
	}

	for (const anchor of container.querySelectorAll("a[href]")) {
		const href = anchor.getAttribute("href") ?? "";

		if (!SAFE_LINK.test(href)) anchor.removeAttribute("href");

		anchor.setAttribute("rel", "noreferrer noopener");
		anchor.setAttribute("target", "_blank");
	}
}

export default function DocxViewer({ src }: ViewerProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [state, setState] = useState<DocxState>("loading");

	useEffect(() => {
		const controller = new AbortController();

		setState("loading");

		async function load(): Promise<void> {
			try {
				// Attachments are member gated, so the session cookie must travel
				// with this cross origin request.
				const response = await fetch(src, {
					credentials: "include",
					signal: controller.signal,
				});

				if (!response.ok) throw new Error("Could not load this document.");

				const buffer = await response.arrayBuffer();

				if (controller.signal.aborted) return;

				// docx-preview is only paid for when a Word file is opened.
				const { renderAsync } = await import("docx-preview");
				const container = containerRef.current;

				if (!container) return;

				container.replaceChildren();

				await renderAsync(buffer, container, undefined, {
					inWrapper: true,
					breakPages: true,
					ignoreLastRenderedPageBreak: true,
				});

				if (controller.signal.aborted) return;

				sanitizeRenderedDocument(container);
				setState("ready");
			} catch {
				if (controller.signal.aborted) return;

				setState("error");
			}
		}

		void load();

		return () => controller.abort();
	}, [src]);

	return (
		<div className="relative h-full min-h-0">
			<div
				ref={containerRef}
				className="h-full overflow-auto bg-app-panel-subtle text-app-text"
			/>

			{state === "loading" && (
				<div className="absolute inset-0 bg-app-panel">
					<ViewerMessage>Loading document...</ViewerMessage>
				</div>
			)}

			{state === "error" && (
				<div className="absolute inset-0 bg-app-panel">
					<ViewerMessage tone="error">
						This document could not be rendered. Download it to open it in Word.
					</ViewerMessage>
				</div>
			)}
		</div>
	);
}
