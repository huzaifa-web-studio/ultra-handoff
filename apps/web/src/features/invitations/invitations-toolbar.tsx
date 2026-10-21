import { Button } from "@org/ui/components/button";
import { Input } from "@org/ui/components/input";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "@org/ui/components/select";
import { BanIcon, RefreshCwIcon, SearchIcon, XIcon } from "lucide-react";

import { BulkActionBar } from "#/components/data-table/bulk-action-bar";
import type {
	InvitationCounts,
	InvitationHistoryQuery,
	InvitationRoleFilter,
	InvitationStatus,
} from "./api";

/**
 * Invitation filters and bulk actions.
 *
 * Why selects instead of chips: status has six values and role has four, so two
 * compact selects keep the toolbar readable and match the members page. The
 * status options are grouped into Active and History, and carry their counts so
 * the size of each bucket is still visible without opening the list.
 *
 * Used by: routes/_app/$orgSlug.settings.invitations.tsx.
 */

type InvitationsToolbarProps = {
	status: "all" | InvitationStatus;
	onStatusChange: (status: "all" | InvitationStatus) => void;
	roleFilter: InvitationRoleFilter;
	onRoleFilterChange: (role: InvitationRoleFilter) => void;
	sortField: InvitationHistoryQuery["sort"];
	onSortFieldChange: (sort: InvitationHistoryQuery["sort"]) => void;
	counts: InvitationCounts;
	/** Rows after every filter, including status. */
	resultCount: number;
	search: string;
	onSearchChange: (value: string) => void;
	selectedCount: number;
	onClearSelection: () => void;
	onBulkResend: () => void;
	onBulkCancel: () => void;
	/** Re-run the invitation query. */
	onRefresh: () => void;
	isRefreshing?: boolean;
};

const STATUS_VALUES = [
	"all",
	"pending",
	"expired",
	"accepted",
	"canceled",
	"rejected",
] as const;

const ROLE_VALUES = ["all", "owner", "admin", "member"] as const;
const SORT_VALUES = ["createdAt", "expiresAt", "email", "status"] as const;

export function InvitationsToolbar({
	status,
	onStatusChange,
	roleFilter,
	onRoleFilterChange,
	sortField,
	onSortFieldChange,
	counts,
	resultCount,
	search,
	onSearchChange,
	selectedCount,
	onClearSelection,
	onBulkResend,
	onBulkCancel,
	onRefresh,
	isRefreshing = false,
}: InvitationsToolbarProps) {
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
						placeholder="Search by email"
						aria-label="Search invitations by email"
						maxLength={254}
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
					aria-label="Filter by status"
					selectedKey={status}
					onSelectionChange={(key) => {
						if (STATUS_VALUES.includes(key as (typeof STATUS_VALUES)[number])) {
							onStatusChange(key as "all" | InvitationStatus);
						}
					}}
				>
					<SelectTrigger size="sm" className="w-44">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem id="all">{`All invitations (${counts.all})`}</SelectItem>
						<SelectGroup>
							<SelectLabel>Active</SelectLabel>
							<SelectItem id="pending">{`Pending (${counts.pending})`}</SelectItem>
							<SelectItem id="expired">{`Expired (${counts.expired})`}</SelectItem>
						</SelectGroup>
						<SelectGroup>
							<SelectLabel>History</SelectLabel>
							<SelectItem id="accepted">{`Accepted (${counts.accepted})`}</SelectItem>
							<SelectItem id="canceled">{`Canceled (${counts.canceled})`}</SelectItem>
							<SelectItem id="rejected">{`Rejected (${counts.rejected})`}</SelectItem>
						</SelectGroup>
					</SelectContent>
				</Select>

				<Select
					aria-label="Filter by role"
					selectedKey={roleFilter}
					onSelectionChange={(key) => {
						if (ROLE_VALUES.includes(key as (typeof ROLE_VALUES)[number])) {
							onRoleFilterChange(key as InvitationRoleFilter);
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
					aria-label="Sort by"
					selectedKey={sortField}
					onSelectionChange={(key) => {
						if (SORT_VALUES.includes(key as (typeof SORT_VALUES)[number])) {
							onSortFieldChange(key as InvitationHistoryQuery["sort"]);
						}
					}}
				>
					<SelectTrigger size="sm" className="w-32">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem id="createdAt">Sent</SelectItem>
						<SelectItem id="expiresAt">Expires</SelectItem>
						<SelectItem id="email">Email</SelectItem>
						<SelectItem id="status">Status</SelectItem>
					</SelectContent>
				</Select>

				<Button
					variant="outline"
					size="icon-sm"
					aria-label="Refresh invitations"
					isDisabled={isRefreshing}
					onPress={onRefresh}
				>
					<RefreshCwIcon
						className={isRefreshing ? "animate-spin" : undefined}
						aria-hidden
					/>
				</Button>

				<p className="ml-auto text-xs text-app-text-muted">
					{resultCount} invitation{resultCount === 1 ? "" : "s"}
					{status !== "all" || roleFilter !== "all" || search.length > 0
						? " in this view"
						: " in total"}
				</p>
			</div>

			{selectedCount > 0 && (
				<BulkActionBar count={selectedCount} onClear={onClearSelection}>
					<Button
						size="sm"
						variant="outline"
						aria-label="Resend selected invitations"
						onPress={onBulkResend}
					>
						<RefreshCwIcon aria-hidden />
						<span className="hidden sm:inline">Resend</span>
					</Button>
					<Button
						size="sm"
						variant="destructive"
						aria-label="Cancel selected invitations"
						onPress={onBulkCancel}
					>
						<BanIcon aria-hidden />
						<span className="hidden sm:inline">Cancel invitations</span>
					</Button>
				</BulkActionBar>
			)}
		</div>
	);
}
