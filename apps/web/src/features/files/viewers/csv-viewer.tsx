"use client";

/**
 * CSV preview.
 *
 * Why a parser instead of splitting on commas: quoted fields, embedded commas
 * and line breaks inside a value are normal in a real export. Papa Parse is
 * loaded on demand so the rest of the app does not pay for it.
 *
 * The preview is bounded by bytes, rows and columns. A hand full of thousand
 * row files should still open instantly, and the download link always has the
 * untouched file.
 *
 * Used by: features/files/file-viewer-dialog.tsx.
 */

import { useEffect, useState } from "react";

import type { ViewerProps } from "../viewer-types";
import { ViewerMessage } from "./viewer-message";

/** Largest file section read before parsing. */
const MAX_BYTES = 2 * 1024 * 1024;

/** Rows rendered, the header included. */
const MAX_ROWS = 500;

/** Columns rendered. Wider exports stay readable. */
const MAX_COLUMNS = 40;

type CsvState =
	| { status: "loading" }
	| { status: "error"; message: string }
	| { status: "ready"; rows: string[][]; truncated: boolean };

/** Pad every row to the same width so the grid stays aligned. */
function normalizeRows(data: string[][], columns: number): string[][] {
	return data.map((row) =>
		Array.from({ length: columns }, (_, index) => row[index] ?? ""),
	);
}

export default function CsvViewer({ src }: ViewerProps) {
	const [state, setState] = useState<CsvState>({ status: "loading" });

	useEffect(() => {
		const controller = new AbortController();

		setState({ status: "loading" });

		async function load(): Promise<void> {
			try {
				const response = await fetch(src, { signal: controller.signal });

				if (!response.ok) throw new Error("Could not load this file.");

				const body = await response.text();
				const sliced = body.length > MAX_BYTES;
				const section = sliced ? body.slice(0, MAX_BYTES) : body;

				// Papa is only paid for when a CSV is actually opened.
				const { default: Papa } = await import("papaparse");

				const parsed = Papa.parse<string[]>(section, {
					preview: MAX_ROWS + 1,
					skipEmptyLines: "greedy",
				});

				if (controller.signal.aborted) return;

				if (parsed.data.length === 0 && parsed.errors.length > 0) {
					throw new Error(
						parsed.errors[0]?.message ?? "Could not read this spreadsheet.",
					);
				}

				const columns = Math.min(
					MAX_COLUMNS,
					Math.max(0, ...parsed.data.map((row) => row.length)),
				);
				const rows = normalizeRows(parsed.data.slice(0, MAX_ROWS), columns);

				setState({
					status: "ready",
					rows,
					truncated: sliced || parsed.meta.truncated,
				});
			} catch (error) {
				if (controller.signal.aborted) return;

				setState({
					status: "error",
					message:
						error instanceof Error
							? error.message
							: "Could not read this spreadsheet.",
				});
			}
		}

		void load();

		return () => controller.abort();
	}, [src]);

	if (state.status === "loading") {
		return <ViewerMessage>Loading spreadsheet...</ViewerMessage>;
	}

	if (state.status === "error") {
		return <ViewerMessage tone="error">{state.message}</ViewerMessage>;
	}

	if (state.rows.length === 0) {
		return <ViewerMessage>This file has no rows to show.</ViewerMessage>;
	}

	const [header, ...body] = state.rows;

	return (
		<div className="flex h-full min-h-0 flex-col">
			{state.truncated && (
				<p className="border-b border-app-border bg-warning-bg px-3 py-1.5 text-xs text-warning">
					Showing the first {MAX_ROWS} rows and {MAX_COLUMNS} columns. Download
					the file for the full spreadsheet.
				</p>
			)}

			<div className="min-h-0 flex-1 overflow-auto">
				<table className="w-full border-collapse text-left text-xs">
					<thead className="sticky top-0 z-10 bg-app-panel">
						<tr>
							{header?.map((cell, index) => (
								<th
									// Column order is the only identity a CSV cell has.
									// biome-ignore lint/suspicious/noArrayIndexKey: positional grid
									key={index}
									scope="col"
									className="border-b border-app-border px-2 py-1.5 font-semibold whitespace-nowrap text-app-text"
								>
									{cell || `Column ${String(index + 1)}`}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{body.map((row, rowIndex) => (
							<tr
								// Row order is the only identity a CSV row has.
								// biome-ignore lint/suspicious/noArrayIndexKey: positional grid
								key={rowIndex}
								className="odd:bg-app-panel-subtle"
							>
								{row.map((cell, cellIndex) => (
									<td
										// biome-ignore lint/suspicious/noArrayIndexKey: positional grid
										key={cellIndex}
										className="border-b border-app-border px-2 py-1 align-top text-app-text"
									>
										{cell}
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}
