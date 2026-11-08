"use client";

/**
 * Excel workbook preview.
 *
 * Why read-excel-file: an .xlsx file is a zip of XML, so a browser cannot show
 * it without a parser. read-excel-file is a small, browser first reader that
 * returns plain cell values, which the app renders as its own table. SheetJS is
 * deliberately avoided because the version published on npm carries known
 * parser advisories, and attachments are untrusted input.
 *
 * The library is loaded on demand, rows and columns are capped, and every cell
 * is rendered through React so a crafted cell value is never injected as HTML.
 *
 * Used by: features/files/file-viewer-dialog.tsx.
 */

import { Button } from "@org/ui/components/button";
import { useEffect, useState } from "react";

import { formatDate } from "#/lib/date";
import type { ViewerProps } from "../viewer-types";
import { ViewerMessage } from "./viewer-message";

/** Rows rendered per sheet, the header row included. */
const MAX_ROWS = 200;

/** Columns rendered per sheet. */
const MAX_COLUMNS = 30;

/** Sheets offered in the tab strip. */
const MAX_SHEETS = 8;

type Sheet = {
	name: string;
	rows: string[][];
	truncated: boolean;
};

type SheetState =
	| { status: "loading" }
	| { status: "error"; message: string }
	| { status: "ready"; sheets: Sheet[] };

/** Render one cell as text, formatting real dates in the product order. */
function cellText(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (value instanceof Date) return formatDate(value);
	if (typeof value === "boolean") return value ? "TRUE" : "FALSE";

	return String(value);
}

export default function SheetViewer({ src }: ViewerProps) {
	const [state, setState] = useState<SheetState>({ status: "loading" });
	const [active, setActive] = useState(0);

	useEffect(() => {
		const controller = new AbortController();

		setState({ status: "loading" });
		setActive(0);

		async function load(): Promise<void> {
			try {
				// Attachments are member gated, so the session cookie must travel
				// with this cross origin request.
				const response = await fetch(src, {
					credentials: "include",
					signal: controller.signal,
				});

				if (!response.ok) throw new Error("Could not load this workbook.");

				const buffer = await response.arrayBuffer();

				if (controller.signal.aborted) return;

				// read-excel-file is only paid for when a spreadsheet is opened.
				const { default: readXlsxFile } = await import(
					"read-excel-file/browser"
				);
				const workbookSheets = await readXlsxFile(buffer);

				if (controller.signal.aborted) return;

				const sheets: Sheet[] = workbookSheets
					.slice(0, MAX_SHEETS)
					.map((sheet) => {
						const columns = Math.min(
							MAX_COLUMNS,
							Math.max(0, ...sheet.data.map((row) => row.length)),
						);

						const rows = sheet.data
							.slice(0, MAX_ROWS)
							.map((row) =>
								Array.from({ length: columns }, (_, index) =>
									cellText(row[index]),
								),
							);

						return {
							name: sheet.sheet,
							rows,
							truncated:
								sheet.data.length > MAX_ROWS ||
								sheet.data.some((row) => row.length > MAX_COLUMNS),
						};
					});

				setState({ status: "ready", sheets });
			} catch (error) {
				if (controller.signal.aborted) return;

				setState({
					status: "error",
					message:
						error instanceof Error
							? error.message
							: "Could not read this workbook.",
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

	if (state.sheets.length === 0) {
		return <ViewerMessage>This workbook has no sheets to show.</ViewerMessage>;
	}

	const sheet = state.sheets[active] ?? state.sheets[0];
	const [header, ...body] = sheet?.rows ?? [];
	const empty = !sheet || sheet.rows.length === 0;

	return (
		<div className="flex h-full min-h-0 flex-col">
			{state.sheets.length > 1 && (
				<div className="flex flex-wrap gap-1 border-b border-app-border bg-app-panel px-2 py-1.5">
					{state.sheets.map((item, index) => (
						<Button
							key={item.name}
							size="xs"
							variant={index === active ? "surface" : "ghost"}
							onPress={() => setActive(index)}
						>
							{item.name || `Sheet ${String(index + 1)}`}
						</Button>
					))}
				</div>
			)}

			{sheet?.truncated && (
				<p className="border-b border-app-border bg-warning-bg px-3 py-1.5 text-xs text-warning">
					Showing the first {MAX_ROWS} rows and {MAX_COLUMNS} columns of this
					sheet. Download the file for the full workbook.
				</p>
			)}

			{empty ? (
				<ViewerMessage>This sheet is empty.</ViewerMessage>
			) : (
				<div className="min-h-0 flex-1 overflow-auto">
					<table className="w-full border-collapse text-left text-xs">
						<thead className="sticky top-0 z-10 bg-app-panel">
							<tr>
								{header?.map((cell, index) => (
									<th
										// Column order is the only identity a sheet cell has.
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
									// Row order is the only identity a sheet row has.
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
			)}
		</div>
	);
}
