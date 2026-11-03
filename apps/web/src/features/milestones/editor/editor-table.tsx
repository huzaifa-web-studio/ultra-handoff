"use client";

/**
 * Table elements for the milestone editor.
 *
 * Why hand written: the registry table is a large component with column and
 * row resizing, border menus, colour menus and block selection. The milestone
 * brief only needs a readable grid that can gain and lose rows and columns, so
 * this version keeps the table plugin's logic and provides a much smaller set
 * of controls.
 *
 * The table node is rendered as a wrapper div with a real `<table>` inside,
 * which is the structure Plate's table plugin expects. Rows and cells are real
 * `tr`, `td` and `th` elements, so pasted cells and screen readers behave.
 *
 * Used by: features/milestones/editor/editor-kit.tsx.
 */

import { Button } from "@org/ui/components/button";
import { Tooltip, TooltipTrigger } from "@org/ui/components/tooltip";
import {
	deleteColumn,
	deleteRow,
	deleteTable,
	insertTableColumn,
	insertTableRow,
	mergeTableCells,
	splitTableCell,
} from "@platejs/table";
import {
	TableProvider,
	useIsCellSelected,
	useTableElement,
	useTableMergeState,
} from "@platejs/table/react";
import { cn } from "cn";
import {
	ArrowDownIcon,
	ArrowLeftIcon,
	ArrowRightIcon,
	ArrowUpIcon,
	CombineIcon,
	SplitIcon,
	Table2Icon,
	Trash2Icon,
} from "lucide-react";
import {
	PlateElement,
	type PlateElementProps,
	useEditorRef,
	useFocused,
	useSelected,
	withHOC,
} from "platejs/react";
import type { ReactNode } from "react";

import { useEditorStatic } from "./editor-view-context";

/** Props shared by a body cell and a header cell. */
type TableCellProps = PlateElementProps & { isHeader?: boolean };

/**
 * Read a cell span from either the node property or pasted HTML attributes.
 *
 * The sanitizer keeps the direct property, so the static viewer only needs to
 * read the node. The attribute fallback covers content that was just pasted
 * and has not been normalised yet.
 */
function readSpan(element: unknown, key: "colSpan" | "rowSpan"): number {
	const node = element as {
		colSpan?: unknown;
		rowSpan?: unknown;
		attributes?: Record<string, unknown>;
	};
	const direct = key === "colSpan" ? node.colSpan : node.rowSpan;

	if (typeof direct === "number" && Number.isInteger(direct) && direct > 0) {
		return direct;
	}

	const attribute =
		node.attributes?.[key === "colSpan" ? "colspan" : "rowspan"];
	const parsed = Number(attribute);

	return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

/** The table in the client's read-only view. */
function TableElementStatic(props: PlateElementProps) {
	return (
		<PlateElement
			{...props}
			className={cn("my-4 overflow-x-auto", props.className)}
		>
			<table className="w-full table-fixed border-collapse text-sm">
				<tbody>{props.children}</tbody>
			</table>
		</PlateElement>
	);
}

/** One cell in the client's read-only view. */
function TableCellStatic({ isHeader, ...props }: TableCellProps) {
	const colSpan = readSpan(props.element, "colSpan");
	const rowSpan = readSpan(props.element, "rowSpan");

	return (
		<PlateElement
			{...props}
			as={isHeader ? "th" : "td"}
			attributes={{ ...props.attributes, colSpan, rowSpan }}
			className={cn(
				"border border-app-border px-2 py-1.5 align-top",
				isHeader && "bg-app-panel-subtle text-left font-semibold",
				props.className,
			)}
		>
			{props.children}
		</PlateElement>
	);
}

/** One editable cell. */
function TableCellEditable({ isHeader, ...props }: TableCellProps) {
	const selected = useIsCellSelected(props.element);
	const colSpan = readSpan(props.element, "colSpan");
	const rowSpan = readSpan(props.element, "rowSpan");

	return (
		<PlateElement
			{...props}
			as={isHeader ? "th" : "td"}
			attributes={{ ...props.attributes, colSpan, rowSpan }}
			className={cn(
				"border border-app-border p-0 align-top",
				isHeader && "bg-app-panel-subtle text-left font-semibold",
				selected && "bg-app-selected",
				props.className,
			)}
		>
			<div className="min-h-8 px-2 py-1.5">{props.children}</div>
		</PlateElement>
	);
}

/** A table cell, with a header variant. */
export function TableCellElement(props: TableCellProps) {
	const isStatic = useEditorStatic();

	return isStatic ? (
		<TableCellStatic {...props} />
	) : (
		<TableCellEditable {...props} />
	);
}

/** The first-row cell. */
export function TableCellHeaderElement(props: PlateElementProps) {
	return <TableCellElement {...props} isHeader />;
}

/** A table row. */
export function TableRowElement(props: PlateElementProps) {
	return (
		<PlateElement
			{...props}
			as="tr"
			className={cn(
				"border-b border-app-border last:border-b-0",
				props.className,
			)}
		/>
	);
}

/** One icon button in the table toolbar. */
function TableAction({
	label,
	onPress,
	children,
}: {
	label: string;
	onPress: () => void;
	children: ReactNode;
}) {
	return (
		<TooltipTrigger>
			<Button
				type="button"
				variant="ghost"
				size="icon-xs"
				aria-label={label}
				onMouseDown={(event) => event.preventDefault()}
				onPress={onPress}
			>
				{children}
			</Button>
			<Tooltip>{label}</Tooltip>
		</TooltipTrigger>
	);
}

/** A compact toolbar shown while the cursor is inside this table. */
function TableToolbar() {
	const editor = useEditorRef();
	const { canMerge, canSplit } = useTableMergeState();

	function run(action: () => void) {
		action();
		editor.tf.focus();
	}

	return (
		<div
			role="toolbar"
			aria-label="Table actions"
			contentEditable={false}
			className="mb-1 flex flex-wrap items-center gap-0.5 border border-app-border bg-app-panel p-0.5"
		>
			<span className="px-1.5 text-[0.6rem] font-semibold tracking-widest text-app-text-muted uppercase">
				Table
			</span>
			<span className="px-1 text-[0.6rem] text-app-text-muted uppercase">
				Row
			</span>
			<TableAction
				label="Add row above"
				onPress={() => run(() => insertTableRow(editor, { before: true }))}
			>
				<ArrowUpIcon aria-hidden />
			</TableAction>
			<TableAction
				label="Add row below"
				onPress={() => run(() => insertTableRow(editor))}
			>
				<ArrowDownIcon aria-hidden />
			</TableAction>
			<TableAction
				label="Delete row"
				onPress={() => run(() => deleteRow(editor))}
			>
				<Trash2Icon aria-hidden />
			</TableAction>

			<span className="px-1 text-[0.6rem] text-app-text-muted uppercase">
				Col
			</span>
			<TableAction
				label="Add column before"
				onPress={() => run(() => insertTableColumn(editor, { before: true }))}
			>
				<ArrowLeftIcon aria-hidden />
			</TableAction>
			<TableAction
				label="Add column after"
				onPress={() => run(() => insertTableColumn(editor))}
			>
				<ArrowRightIcon aria-hidden />
			</TableAction>
			<TableAction
				label="Delete column"
				onPress={() => run(() => deleteColumn(editor))}
			>
				<Trash2Icon aria-hidden />
			</TableAction>

			{canMerge && (
				<TableAction
					label="Merge cells"
					onPress={() => run(() => mergeTableCells(editor))}
				>
					<CombineIcon aria-hidden />
				</TableAction>
			)}
			{canSplit && (
				<TableAction
					label="Split cell"
					onPress={() => run(() => splitTableCell(editor))}
				>
					<SplitIcon aria-hidden />
				</TableAction>
			)}

			<TableAction
				label="Delete table"
				onPress={() => run(() => deleteTable(editor))}
			>
				<Table2Icon aria-hidden />
			</TableAction>
		</div>
	);
}

/** The editable table, wrapped in the provider its cells read from. */
const TableElementEditable = withHOC(
	TableProvider,
	function TableElementEditable(props: PlateElementProps) {
		const { marginLeft, props: tableProps } = useTableElement();
		const selected = useSelected();
		const focused = useFocused();

		return (
			<PlateElement
				{...props}
				className={cn("my-4", props.className)}
				style={{ ...props.style, paddingLeft: marginLeft }}
			>
				{selected && focused && <TableToolbar />}

				<div className="overflow-x-auto">
					<table
						{...tableProps}
						className="w-full table-fixed border-collapse text-sm"
					>
						<tbody>{props.children}</tbody>
					</table>
				</div>
			</PlateElement>
		);
	},
);

/** The table element, editable or static. */
export function TableElement(props: PlateElementProps) {
	const isStatic = useEditorStatic();

	return isStatic ? (
		<TableElementStatic {...props} />
	) : (
		<TableElementEditable {...props} />
	);
}
