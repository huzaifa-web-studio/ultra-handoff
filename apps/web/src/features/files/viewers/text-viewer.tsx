"use client";

/**
 * Plain text preview.
 *
 * Why fetch instead of an iframe: the API sends text with a no-script policy and
 * some browsers download `text/plain` depending on the disposition. Reading the
 * body and rendering it inside the app gives one predictable surface.
 *
 * A very large file is cut at a safe character count. The full file is still
 * one Download away, and rendering ten megabytes of text would freeze the tab.
 *
 * Used by: features/files/file-viewer-dialog.tsx.
 */

import { useEffect, useState } from "react";

import type { ViewerProps } from "../viewer-types";
import { ViewerMessage } from "./viewer-message";

/** Largest text preview rendered. The download link is the full file. */
const MAX_CHARACTERS = 300_000;

type TextState =
	| { status: "loading" }
	| { status: "error"; message: string }
	| { status: "ready"; text: string; truncated: boolean };

export default function TextViewer({ src }: ViewerProps) {
	const [state, setState] = useState<TextState>({ status: "loading" });

	useEffect(() => {
		const controller = new AbortController();

		setState({ status: "loading" });

		async function load(): Promise<void> {
			try {
				// Attachments are member gated, so the session cookie must travel
				// with this cross origin request.
				const response = await fetch(src, {
					credentials: "include",
					signal: controller.signal,
				});

				if (!response.ok) throw new Error("Could not load this file.");

				const body = await response.text();

				if (controller.signal.aborted) return;

				setState({
					status: "ready",
					text: body.slice(0, MAX_CHARACTERS),
					truncated: body.length > MAX_CHARACTERS,
				});
			} catch (error) {
				if (controller.signal.aborted) return;

				setState({
					status: "error",
					message:
						error instanceof Error
							? error.message
							: "Could not load this file.",
				});
			}
		}

		void load();

		return () => controller.abort();
	}, [src]);

	if (state.status === "loading") {
		return <ViewerMessage>Loading text...</ViewerMessage>;
	}

	if (state.status === "error") {
		return <ViewerMessage tone="error">{state.message}</ViewerMessage>;
	}

	return (
		<div className="flex h-full min-h-0 flex-col">
			{state.truncated && (
				<p className="border-b border-app-border bg-warning-bg px-3 py-1.5 text-xs text-warning">
					Showing the first{" "}
					{new Intl.NumberFormat("en-GB").format(MAX_CHARACTERS)} characters.
					Download the file to read all of it.
				</p>
			)}

			<pre className="min-h-0 flex-1 overflow-auto bg-app-panel-subtle p-4 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-app-text">
				{state.text}
			</pre>
		</div>
	);
}
