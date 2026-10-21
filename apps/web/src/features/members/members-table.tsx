import { Badge } from "@org/ui/components/badge";
import { Button } from "@org/ui/components/button";
import { Checkbox } from "@org/ui/components/checkbox";
import {
	DropdownMenu,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@org/ui/components/dropdown-menu";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@org/ui/components/select";
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
	type FilterFn,
	flexRender,
	getCoreRowModel,
	getFilteredRowModel,
	getPaginationRowModel,
	getSortedRowModel,
	type OnChangeFn,
	type PaginationState,
	type SortingState,
	useReactTable,
} from "@tanstack/react-table";
import { CopyIcon, MoreHorizontalIcon, Trash2Icon } from "lucide-react";
import { memo, useMemo } from "react";
import type { Selection, SortDescriptor } from "react-aria-components";
import { toast } from "sonner";
import { SortIndicator } from "#/components/data-table/sort-indicator";
import { RoleChip } from "#/components/role-chip";
import { UserAvatar } from "#/components/user-avatar";
import {
	assignableMemberRoles,
	canManageTarget,
	organizationRoleLabel,
	roleParts,
} from "#/features/organization/permissions";
import { formatDate } from "#/lib/date";
import type { MemberRow } from "./api";

/**
 * Members table.
 *
 * Why a hybrid: TanStack Table owns the data model (column definitions,
 * search, sorting) because the page asked for it, while react-aria's Table
 * primitives render the markup and own selection and ARIA. Sorting has one
 * source of truth: the TanStack state drives the react-aria sort descriptor, so
 * TanStack sorts the rows and screen readers still hear the sort direction.
 *
 * Used by: routes/_app/$orgSlug.settings.members.tsx.
 */

type MembersTableProps = {
	members: MemberRow[];
	viewerRole: string;
	canManage: boolean;
	ownerCount: number;
	selected: Set<string>;
	onSelectedChange: (next: Set<string>) => void;
	sorting: SortingState;
	onSortingChange: (next: SortingState) => void;
	globalFilter: string;
	pagination: PaginationState;
	onPaginationChange: OnChangeFn<PaginationState>;
	onRoleChange: (member: MemberRow, role: "member" | "admin" | "owner") => void;
	onRemove: (members: MemberRow[]) => void;
};

/**
 * Search across the fields a person would type.
 *
 * Exported so the toolbar can show "3 of 24 members" with the same rule the
 * table applies, instead of a second, drifting predicate.
 */
export function matchesMemberSearch(member: MemberRow, query: string): boolean {
	const normalized = query.trim().toLowerCase();

	if (normalized.length === 0) return true;

	return [
		member.name,
		member.email,
		member.role,
		organizationRoleLabel(member.role),
	].some((value) => value.toLowerCase().includes(normalized));
}

const memberFilter: FilterFn<MemberRow> = (row, _columnId, filterValue) =>
	matchesMemberSearch(row.original, String(filterValue ?? ""));

/**
 * The table lives in a card with its own scroll area, so the column header
 * stays visible while the rows scroll. The background must be opaque or the
 * rows show through.
 */
const STICKY_HEADER =
	"sticky top-0 z-10 border-b border-app-border bg-app-panel";

/** Copy an address without pretending it worked when the clipboard is denied. */
async function copyEmail(email: string) {
	try {
		await navigator.clipboard.writeText(email);
		toast.success("Email address copied.");
	} catch {
		toast.error("Could not copy the email address.");
	}
}

/**
 * Role control, memoised on purpose.
 *
 * Selecting a row updates the page state, which re-renders the table. Without
 * memo, every one of those renders rebuilt a react-aria Select for every row,
 * which is what made the checkbox feel delayed. The props here only change when
 * the member or the viewer's permissions actually change.
 */
const MemberRoleCell = memo(function MemberRoleCell({
	member,
	viewerRole,
	canManage,
	onChange,
}: {
	member: MemberRow;
	viewerRole: string;
	canManage: boolean;
	onChange: (member: MemberRow, role: "member" | "admin" | "owner") => void;
}) {
	return (
		<MemberRoleSelect
			member={member}
			viewerRole={viewerRole}
			canManage={canManage}
			onChange={onChange}
		/>
	);
});

/** Row menu, memoised for the same reason: its Menu is costly to rebuild. */
const MemberActionsCell = memo(function MemberActionsCell({
	member,
	canManage,
	viewerRole,
	ownerCount,
	onRemove,
}: {
	member: MemberRow;
	canManage: boolean;
	viewerRole: string;
	ownerCount: number;
	onRemove: (members: MemberRow[]) => void;
}) {
	const canRemove =
		canManage &&
		!member.isSelf &&
		canManageTarget(viewerRole, member.role) &&
		!(member.isOwner && ownerCount <= 1);

	return (
		<div className="flex justify-end">
			<DropdownMenuTrigger>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={`Actions for ${member.name}`}
				>
					<MoreHorizontalIcon />
				</Button>
				<DropdownMenu>
					<DropdownMenuItem onAction={() => copyEmail(member.email)}>
						<CopyIcon aria-hidden />
						Copy email
					</DropdownMenuItem>
					{canRemove && (
						<DropdownMenuItem
							variant="destructive"
							onAction={() => onRemove([member])}
						>
							<Trash2Icon aria-hidden />
							Remove member
						</DropdownMenuItem>
					)}
				</DropdownMenu>
			</DropdownMenuTrigger>
		</div>
	);
});

export function MembersTable({
	members,
	viewerRole,
	canManage,
	ownerCount,
	selected,
	onSelectedChange,
	sorting,
	onSortingChange,
	globalFilter,
	pagination,
	onPaginationChange,
	onRoleChange,
	onRemove,
}: MembersTableProps) {
	const columns = useMemo<ColumnDef<MemberRow>[]>(
		() => [
			{
				id: "member",
				accessorFn: (row) => `${row.name} ${row.email}`,
				header: "Member",
				cell: ({ row }) => (
					<div className="flex min-w-0 items-center gap-2.5">
						<UserAvatar
							size="sm"
							name={row.original.name}
							src={row.original.image}
						/>
						<div className="flex min-w-0 flex-col">
							<span
								className="max-w-56 truncate font-medium text-app-text"
								title={row.original.name}
							>
								{row.original.name}
							</span>
							<span
								className="max-w-56 truncate text-xs text-app-text-muted"
								title={row.original.email}
							>
								{row.original.email}
							</span>
						</div>
					</div>
				),
			},
			{
				id: "role",
				accessorFn: (row) => row.role,
				header: "Role",
				cell: ({ row }) => (
					<MemberRoleCell
						member={row.original}
						viewerRole={viewerRole}
						canManage={canManage}
						onChange={onRoleChange}
					/>
				),
			},
			{
				id: "status",
				accessorFn: (row) =>
					row.isSelf ? "you" : row.emailVerified ? "active" : "unverified",
				header: "Status",
				enableSorting: false,
				cell: ({ row }) => <MemberStatus member={row.original} />,
			},
			{
				id: "joined",
				accessorFn: (row) => row.createdAt,
				header: "Joined",
				sortingFn: "datetime",
				cell: ({ row }) => (
					<span className="text-sm text-app-text-muted">
						{formatDate(row.original.createdAt)}
					</span>
				),
			},
			{
				id: "actions",
				header: "",
				enableSorting: false,
				cell: ({ row }) => (
					<MemberActionsCell
						member={row.original}
						canManage={canManage}
						viewerRole={viewerRole}
						ownerCount={ownerCount}
						onRemove={onRemove}
					/>
				),
			},
		],
		[viewerRole, canManage, ownerCount, onRoleChange, onRemove],
	);

	const table = useReactTable({
		data: members,
		columns,
		state: { sorting, globalFilter, pagination },
		onSortingChange: (updater) => {
			onSortingChange(
				typeof updater === "function" ? updater(sorting) : updater,
			);
		},
		onPaginationChange,
		globalFilterFn: memberFilter,
		getRowId: (row) => row.id,
		getCoreRowModel: getCoreRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getPaginationRowModel: getPaginationRowModel(),
	});

	const sortDescriptor = useMemo<SortDescriptor | undefined>(() => {
		const first = sorting[0];

		if (!first) return undefined;

		return {
			column: first.id,
			direction: first.desc ? "descending" : "ascending",
		};
	}, [sorting]);

	const rows = table.getRowModel().rows;
	const visibleIds = rows.map((row) => row.id);

	function handleSelectionChange(keys: Selection) {
		if (keys === "all") {
			onSelectedChange(new Set(visibleIds));
			return;
		}

		onSelectedChange(new Set(Array.from(keys).map(String)));
	}

	return (
		<Table
			aria-label="Organization members"
			containerClassName="overflow-visible"
			selectionMode={canManage ? "multiple" : "none"}
			selectedKeys={selected}
			onSelectionChange={handleSelectionChange}
			sortDescriptor={sortDescriptor}
			onSortChange={(descriptor) => {
				onSortingChange([
					{
						id: String(descriptor.column),
						desc: descriptor.direction === "descending",
					},
				]);
			}}
		>
			<TableHeader>
				{canManage && (
					<TableHead className={`${STICKY_HEADER} w-10`}>
						<Checkbox slot="selection" aria-label="Select all members" />
					</TableHead>
				)}
				{(table.getHeaderGroups()[0]?.headers ?? []).map((header) => {
					const sorted = header.column.getIsSorted();
					const canSort = header.column.getCanSort();
					const label =
						typeof header.column.columnDef.header === "string"
							? header.column.columnDef.header
							: header.column.id;
					// Tell the user what the next click will do, not just the
					// current state. Clicking an ascending column flips it.
					const hint = canSort
						? `Sort by ${label} ${sorted === "asc" ? "descending" : "ascending"}`
						: undefined;

					return (
						<TableHead
							key={header.id}
							id={header.column.id}
							isRowHeader={header.column.id === "member"}
							allowsSorting={canSort}
							className={`${STICKY_HEADER}${canSort ? " cursor-pointer" : ""}`}
						>
							{header.isPlaceholder ? null : (
								<span className="inline-flex items-center gap-1.5" title={hint}>
									{flexRender(
										header.column.columnDef.header,
										header.getContext(),
									)}
									{canSort && <SortIndicator direction={sorted} />}
								</span>
							)}
						</TableHead>
					);
				})}
			</TableHeader>
			<TableBody
				renderEmptyState={() => (
					<div className="px-3 py-10 text-center text-sm text-app-text-muted">
						No members match your search.
					</div>
				)}
			>
				{rows.map((row) => (
					<TableRow key={row.id} id={row.id}>
						{canManage && (
							<TableCell>
								<Checkbox
									slot="selection"
									aria-label={`Select ${row.original.name}`}
								/>
							</TableCell>
						)}
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

/**
 * Inline role control.
 *
 * Owner is offered here as a single row action, and the parent opens a
 * confirmation before applying it. The Select stays controlled by the member's
 * current role, so cancelling the confirmation leaves the old role on screen.
 */
function MemberRoleSelect({
	member,
	viewerRole,
	canManage,
	onChange,
}: {
	member: MemberRow;
	viewerRole: string;
	canManage: boolean;
	onChange: (member: MemberRow, role: "member" | "admin" | "owner") => void;
}) {
	const options = assignableMemberRoles(viewerRole);
	const disabled =
		!canManage || member.isSelf || !canManageTarget(viewerRole, member.role);
	const current = (roleParts(member.role)[0] ?? "member") as
		| "member"
		| "admin"
		| "owner";

	if (disabled) {
		return <RoleChip role={member.role} />;
	}

	return (
		<Select
			aria-label={`Role for ${member.name}`}
			selectedKey={current}
			onSelectionChange={(key) => {
				if (key === current) return;

				if (key === "member" || key === "admin" || key === "owner") {
					onChange(member, key);
				}
			}}
		>
			<SelectTrigger size="sm" className="w-32">
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				<SelectItem id="member">Member</SelectItem>
				<SelectItem id="admin">Admin</SelectItem>
				{options.includes("owner") && <SelectItem id="owner">Owner</SelectItem>}
			</SelectContent>
		</Select>
	);
}

/** Small status stamps: self, unverified, active. Text always present. */
function MemberStatus({ member }: { member: MemberRow }) {
	if (member.isSelf) {
		return <Badge className="bg-app-selected text-app-text">You</Badge>;
	}

	if (!member.emailVerified) {
		return <Badge className="bg-warning-bg text-warning">Unverified</Badge>;
	}

	return <Badge className="bg-success-bg text-success">Active</Badge>;
}
