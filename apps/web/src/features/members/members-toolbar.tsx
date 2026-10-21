import { Button } from "@org/ui/components/button";
import { Input } from "@org/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@org/ui/components/select";
import {
	RefreshCwIcon,
	SearchIcon,
	ShieldCheckIcon,
	Trash2Icon,
	UserRoundIcon,
	XIcon,
} from "lucide-react";

import { BulkActionBar } from "#/components/data-table/bulk-action-bar";
import type { OrgRole } from "#/features/organization/permissions";

/**
 * Members search, role filter and bulk action bar.
 *
 * Why separate from the table: the toolbar changes on every keystroke, while
 * the table should only re-render when the filtered rows change. Keeping the
 * controls above also gives the bulk bar a stable place to appear.
 *
 * Used by: routes/_app/$orgSlug.settings.members.tsx.
 */

type MembersToolbarProps = {
	search: string;
	onSearchChange: (value: string) => void;
	roleFilter: "all" | OrgRole;
	onRoleFilterChange: (value: "all" | OrgRole) => void;
	statusFilter: "all" | "active" | "unverified";
	onStatusFilterChange: (value: "all" | "active" | "unverified") => void;
	sortField: "member" | "role" | "joined";
	onSortFieldChange: (value: "member" | "role" | "joined") => void;
	visibleCount: number;
	totalCount: number;
	canManage: boolean;
	selectedCount: number;
	onClearSelection: () => void;
	onBulkRole: (role: "member" | "admin") => void;
	onBulkRemove: () => void;
	/** Re-run the member query. */
	onRefresh: () => void;
	isRefreshing?: boolean;
};

export function MembersToolbar({
	search,
	onSearchChange,
	roleFilter,
	onRoleFilterChange,
	statusFilter,
	onStatusFilterChange,
	sortField,
	onSortFieldChange,
	visibleCount,
	totalCount,
	canManage,
	selectedCount,
	onClearSelection,
	onBulkRole,
	onBulkRemove,
	onRefresh,
	isRefreshing = false,
}: MembersToolbarProps) {
	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-wrap items-center gap-3">
				<div className="relative w-full max-w-xs">
					<SearchIcon
						className="pointer-events-none absolute top-1/2 left-0 size-3.5 -translate-y-1/2 text-app-text-muted"
						aria-hidden
					/>
					<Input
						type="search"
						value={search}
						onChange={(event) => onSearchChange(event.target.value)}
						placeholder="Search name, email or role"
						aria-label="Search members"
						className="pl-6"
					/>
					{search.length > 0 && (
						<Button
							variant="ghost"
							size="icon-xs"
							className="absolute top-1/2 right-0 -translate-y-1/2"
							aria-label="Clear search"
							onPress={() => onSearchChange("")}
						>
							<XIcon />
						</Button>
					)}
				</div>

				<Select
					aria-label="Filter by role"
					selectedKey={roleFilter}
					onSelectionChange={(key) => {
						if (
							key === "all" ||
							key === "owner" ||
							key === "admin" ||
							key === "member"
						) {
							onRoleFilterChange(key);
						}
					}}
				>
					<SelectTrigger size="sm" className="w-36">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem id="all">All roles</SelectItem>
						<SelectItem id="owner">Owners</SelectItem>
						<SelectItem id="admin">Admins</SelectItem>
						<SelectItem id="member">Members</SelectItem>
					</SelectContent>
				</Select>

				<Select
					aria-label="Filter by status"
					selectedKey={statusFilter}
					onSelectionChange={(key) => {
						if (key === "all" || key === "active" || key === "unverified") {
							onStatusFilterChange(key);
						}
					}}
				>
					<SelectTrigger size="sm" className="w-32">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem id="all">All statuses</SelectItem>
						<SelectItem id="active">Active</SelectItem>
						<SelectItem id="unverified">Unverified</SelectItem>
					</SelectContent>
				</Select>

				<Select
					aria-label="Sort by"
					selectedKey={sortField}
					onSelectionChange={(key) => {
						if (key === "member" || key === "role" || key === "joined") {
							onSortFieldChange(key);
						}
					}}
				>
					<SelectTrigger size="sm" className="w-32">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem id="member">Name</SelectItem>
						<SelectItem id="role">Role</SelectItem>
						<SelectItem id="joined">Joined</SelectItem>
					</SelectContent>
				</Select>

				<Button
					variant="outline"
					size="icon-sm"
					aria-label="Refresh members"
					isDisabled={isRefreshing}
					onPress={onRefresh}
				>
					<RefreshCwIcon
						className={isRefreshing ? "animate-spin" : undefined}
						aria-hidden
					/>
				</Button>

				<p className="ml-auto text-xs text-app-text-muted">
					{visibleCount === totalCount
						? `${totalCount} member${totalCount === 1 ? "" : "s"}`
						: `${visibleCount} of ${totalCount} members`}
				</p>
			</div>

			{canManage && selectedCount > 0 && (
				<BulkActionBar count={selectedCount} onClear={onClearSelection}>
					<Button
						size="sm"
						variant="outline"
						aria-label="Set selected members as member"
						onPress={() => onBulkRole("member")}
					>
						<UserRoundIcon aria-hidden />
						<span className="hidden sm:inline">Set as member</span>
					</Button>
					<Button
						size="sm"
						variant="outline"
						aria-label="Set selected members as admin"
						onPress={() => onBulkRole("admin")}
					>
						<ShieldCheckIcon aria-hidden />
						<span className="hidden sm:inline">Set as admin</span>
					</Button>
					<Button
						size="sm"
						variant="destructive"
						aria-label="Remove selected members"
						onPress={onBulkRemove}
					>
						<Trash2Icon aria-hidden />
						<span className="hidden sm:inline">Remove</span>
					</Button>
				</BulkActionBar>
			)}
		</div>
	);
}
