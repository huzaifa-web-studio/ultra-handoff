import { Button } from "@org/ui/components/button";
import { Checkbox } from "@org/ui/components/checkbox";
import {
	DropdownMenu,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@org/ui/components/dropdown-menu";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@org/ui/components/table";
import {
	type ColumnDef,
	flexRender,
	getCoreRowModel,
	useReactTable,
} from "@tanstack/react-table";
import {
	BanIcon,
	CopyIcon,
	MoreHorizontalIcon,
	RefreshCwIcon,
	UserPlusIcon,
} from "lucide-react";
import { memo, useMemo } from "react";
import type { Selection, SortDescriptor } from "react-aria-components";
import { toast } from "sonner";

import { SortIndicator } from "#/components/data-table/sort-indicator";
import { RoleChip } from "#/components/role-chip";
import { formatDate, formatDateTime, formatRelativeTime } from "#/lib/date";
import type { InvitationHistoryQuery, InvitationRow } from "./api";
import {
	InvitationStatusChip,
	isActionableStatus,
} from "./invitation-status-chip";

/**
 * Invitation history table.
 *
 * Why manual sorting: the history is paginated by the server. Sorting a single
 * page in the browser would lie about the rest of the rows, so the table only
 * renders what the API returned and reports sort changes upward. Selection is
 * limited to pending and expired rows, the only ones with live actions.
 *
 * Used by: routes/_app/$orgSlug.settings.invitations.tsx.
 */

type InvitationsTableProps = {
	rows: InvitationRow[];
	emptyMessage: string;
	selected: Set<string>;
	onSelectedChange: (next: Set<string>) => void;
	sort: InvitationHistoryQuery["sort"];
	direction: InvitationHistoryQuery["direction"];
	onSortChange: (
		sort: InvitationHistoryQuery["sort"],
		direction: InvitationHistoryQuery["direction"],
	) => void;
	onResend: (row: InvitationRow) => void;
	onCancel: (row: InvitationRow) => void;
	onInviteAgain: (email: string, role: string) => void;
};

async function copyEmail(email: string) {
	try {
		await navigator.clipboard.writeText(email);
		toast.success("Email address copied.");
	} catch {
		toast.error("Could not copy the email address.");
	}
}

/**
 * The table lives in a card with its own scroll area, so the column header
 * stays visible while the rows scroll. The background must be opaque or the
 * rows show through.
 */
const STICKY_HEADER =
	"sticky top-0 z-10 border-b border-app-border bg-app-panel";

/**
 * Row menu, memoised so a selection change does not rebuild a Menu for every
 * row. The callbacks come from the page, which keeps them stable.
 */
const InvitationActionsCell = memo(function InvitationActionsCell({
	invitation,
	onResend,
	onCancel,
	onInviteAgain,
}: {
	invitation: InvitationRow;
	onResend: (row: InvitationRow) => void;
	onCancel: (row: InvitationRow) => void;
	onInviteAgain: (email: string, role: string) => void;
}) {
	const canAct = isActionableStatus(invitation.status);

	return (
		<div className="flex justify-end">
			<DropdownMenuTrigger>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={`Actions for ${invitation.email}`}
				>
					<MoreHorizontalIcon />
				</Button>
				<DropdownMenu>
					<DropdownMenuItem onAction={() => copyEmail(invitation.email)}>
						<CopyIcon aria-hidden />
						Copy email
					</DropdownMenuItem>
					{canAct && (
						<>
							<DropdownMenuItem onAction={() => onResend(invitation)}>
								<RefreshCwIcon aria-hidden />
								Resend invitation
							</DropdownMenuItem>
							<DropdownMenuItem
								variant="destructive"
								onAction={() => onCancel(invitation)}
							>
								<BanIcon aria-hidden />
								Cancel invitation
							</DropdownMenuItem>
						</>
					)}
					{(invitation.status === "canceled" ||
						invitation.status === "rejected") && (
						<DropdownMenuItem
							onAction={() => onInviteAgain(invitation.email, invitation.role)}
						>
							<UserPlusIcon aria-hidden />
							Invite again
						</DropdownMenuItem>
					)}
				</DropdownMenu>
			</DropdownMenuTrigger>
		</div>
	);
});

export function InvitationsTable({
	rows,
	emptyMessage,
	selected,
	onSelectedChange,
	sort,
	direction,
	onSortChange,
	onResend,
	onCancel,
	onInviteAgain,
}: InvitationsTableProps) {
	const columns = useMemo<ColumnDef<InvitationRow>[]>(
		() => [
			{
				id: "email",
				accessorFn: (row) => row.email,
				header: "Email",
				cell: ({ row }) => (
					<span
						className="block max-w-60 truncate text-sm font-medium text-app-text"
						title={row.original.email}
					>
						{row.original.email}
					</span>
				),
			},
			{
				id: "role",
				accessorFn: (row) => row.role,
				header: "Role",
				enableSorting: false,
				cell: ({ row }) => <RoleChip role={row.original.role} />,
			},
			{
				id: "status",
				accessorFn: (row) => row.status,
				header: "Status",
				cell: ({ row }) => (
					<InvitationStatusChip status={row.original.status} />
				),
			},
			{
				id: "inviter",
				accessorFn: (row) => row.inviterName,
				header: "Invited by",
				enableSorting: false,
				cell: ({ row }) => (
					<div className="flex min-w-0 flex-col">
						<span
							className="max-w-44 truncate text-sm text-app-text"
							title={row.original.inviterName}
						>
							{row.original.inviterName}
						</span>
						{row.original.inviterEmail && (
							<span
								className="max-w-44 truncate text-xs text-app-text-muted"
								title={row.original.inviterEmail}
							>
								{row.original.inviterEmail}
							</span>
						)}
					</div>
				),
			},
			{
				id: "createdAt",
				accessorFn: (row) => row.createdAt,
				header: "Sent",
				cell: ({ row }) => (
					<span
						className="text-sm text-app-text-muted"
						title={formatDateTime(row.original.createdAt)}
					>
						{formatDate(row.original.createdAt)}
					</span>
				),
			},
			{
				id: "expiresAt",
				accessorFn: (row) => row.expiresAt,
				header: "Expires",
				cell: ({ row }) => (
					<span
						className="text-sm text-app-text-muted"
						title={formatDateTime(row.original.expiresAt)}
					>
						{formatRelativeTime(row.original.expiresAt)}
					</span>
				),
			},
			{
				id: "actions",
				header: "",
				enableSorting: false,
				cell: ({ row }) => (
					<InvitationActionsCell
						invitation={row.original}
						onResend={onResend}
						onCancel={onCancel}
						onInviteAgain={onInviteAgain}
					/>
				),
			},
		],
		[onResend, onCancel, onInviteAgain],
	);

	const table = useReactTable({
		data: rows,
		columns,
		getRowId: (row) => row.id,
		getCoreRowModel: getCoreRowModel(),
	});

	const sortDescriptor: SortDescriptor = {
		column: sort,
		direction: direction === "asc" ? "ascending" : "descending",
	};

	const disabledKeys = new Set(
		rows.filter((row) => !isActionableStatus(row.status)).map((row) => row.id),
	);

	function handleSelectionChange(keys: Selection) {
		const selectable = rows
			.filter((row) => isActionableStatus(row.status))
			.map((row) => row.id);

		if (keys === "all") {
			onSelectedChange(new Set(selectable));
			return;
		}

		const allowed = new Set(selectable);
		onSelectedChange(
			new Set(
				Array.from(keys)
					.map(String)
					.filter((id) => allowed.has(id)),
			),
		);
	}

	return (
		<Table
			aria-label="Invitation history"
			containerClassName="overflow-visible"
			selectionMode="multiple"
			disabledBehavior="selection"
			disabledKeys={disabledKeys}
			selectedKeys={selected}
			onSelectionChange={handleSelectionChange}
			sortDescriptor={sortDescriptor}
			onSortChange={(descriptor) => {
				const nextSort = String(descriptor.column);

				// Column ids double as the server sort keys, so only the four
				// sortable ones can reach this handler.
				if (
					nextSort !== "createdAt" &&
					nextSort !== "expiresAt" &&
					nextSort !== "email" &&
					nextSort !== "status"
				) {
					return;
				}

				onSortChange(
					nextSort,
					descriptor.direction === "descending" ? "desc" : "asc",
				);
			}}
		>
			<TableHeader>
				<TableHead className={`${STICKY_HEADER} w-10`}>
					<Checkbox
						slot="selection"
						aria-label="Select all actionable invitations"
					/>
				</TableHead>
				{(table.getHeaderGroups()[0]?.headers ?? []).map((header) => {
					const canSort = header.column.getCanSort();
					// Sorting is manual here, so the active column comes from the
					// page's `sort` prop rather than TanStack's own state.
					const isActive = header.column.id === sort;
					const activeDirection = isActive ? direction : false;
					const label =
						typeof header.column.columnDef.header === "string"
							? header.column.columnDef.header
							: header.column.id;
					const hint = canSort
						? `Sort by ${label} ${
								isActive && direction === "asc" ? "descending" : "ascending"
							}`
						: undefined;

					return (
						<TableHead
							key={header.id}
							id={header.column.id}
							isRowHeader={header.column.id === "email"}
							allowsSorting={canSort}
							className={`${STICKY_HEADER}${canSort ? " cursor-pointer" : ""}`}
						>
							{header.isPlaceholder ? null : (
								<span className="inline-flex items-center gap-1.5" title={hint}>
									{flexRender(
										header.column.columnDef.header,
										header.getContext(),
									)}
									{canSort && <SortIndicator direction={activeDirection} />}
								</span>
							)}
						</TableHead>
					);
				})}
			</TableHeader>
			<TableBody
				renderEmptyState={() => (
					<div className="px-3 py-10 text-center text-sm text-app-text-muted">
						{emptyMessage}
					</div>
				)}
			>
				{table.getRowModel().rows.map((row) => (
					<TableRow key={row.id} id={row.id}>
						<TableCell>
							<Checkbox
								slot="selection"
								aria-label={`Select ${row.original.email}`}
							/>
						</TableCell>
						{row.getVisibleCells().map((cell) => (
							<TableCell key={cell.id}>
								{flexRender(cell.column.columnDef.cell, cell.getContext())}
							</TableCell>
						))}
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}
