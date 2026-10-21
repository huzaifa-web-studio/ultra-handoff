/**
 * Members page.
 *
 * Why one page component: the table, toolbar, role confirmation and removal
 * dialog all edit the same list, so they share the selection, the search and
 * the sorting state here. The API call owns the authoritative role checks; the
 * UI only hides actions the caller cannot perform.
 *
 * Used by: the settings layout at `/$orgSlug/settings/members`.
 */

import { Button } from "@org/ui/components/button";
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@org/ui/components/dialog";
import { Skeleton } from "@org/ui/components/skeleton";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { PaginationState, SortingState } from "@tanstack/react-table";
import {
	ArrowRightIcon,
	CrownIcon,
	RefreshCwIcon,
	UserPlusIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { TableLoader } from "#/components/data-table/table-loader";
import { TablePagination } from "#/components/data-table/table-pagination";
import { RoleChip } from "#/components/role-chip";
import { InviteMembersDialog } from "#/features/invitations/invite-members-dialog";
import { DEFAULT_INVITATIONS_SEARCH } from "#/features/invitations/search";
import type { MemberRow } from "#/features/members/api";
import {
	useBulkUpdateMemberRole,
	useMembers,
	useUpdateMemberRole,
} from "#/features/members/hooks";
import {
	MembersTable,
	matchesMemberSearch,
} from "#/features/members/members-table";
import { MembersToolbar } from "#/features/members/members-toolbar";
import { RemoveMembersDialog } from "#/features/members/remove-members-dialog";
import { type OrgRole, roleParts } from "#/features/organization/permissions";
import { beginOrganizationOperation } from "#/features/organization/switch-guard";

export const Route = createFileRoute("/_app/$orgSlug/settings/members")({
	component: MembersPage,
	staticData: { breadcrumb: "Members" },
});

function MembersPage() {
	const { orgSlug } = Route.useParams();
	const membersQuery = useMembers(orgSlug);
	const updateRole = useUpdateMemberRole(orgSlug);
	const bulkRole = useBulkUpdateMemberRole(orgSlug);

	const [search, setSearch] = useState("");
	const [roleFilter, setRoleFilter] = useState<"all" | OrgRole>("all");
	const [statusFilter, setStatusFilter] = useState<
		"all" | "active" | "unverified"
	>("all");
	const [sorting, setSorting] = useState<SortingState>([
		{ id: "joined", desc: false },
	]);
	const [pagination, setPagination] = useState<PaginationState>({
		pageIndex: 0,
		pageSize: 20,
	});
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [inviteOpen, setInviteOpen] = useState(false);
	const [removeTargets, setRemoveTargets] = useState<MemberRow[]>([]);
	const [pendingOwner, setPendingOwner] = useState<MemberRow | null>(null);

	const data = membersQuery.data;

	// Selection and the page position never survive a filter change. Otherwise
	// a bulk action could touch a row the user can no longer see, or the table
	// could open on a page that no longer exists.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset on filter change
	useEffect(() => {
		setSelected(new Set());
		setPagination((prev) => ({ ...prev, pageIndex: 0 }));
	}, [search, roleFilter, statusFilter]);

	const filteredMembers = useMemo(() => {
		const members = data?.members ?? [];

		return members.filter((member) => {
			// Match the primary role, which is the one the Role column shows.
			const primaryRole = roleParts(member.role)[0] ?? "member";
			const matchesRole = roleFilter === "all" || primaryRole === roleFilter;
			const matchesStatus =
				statusFilter === "all" ||
				(statusFilter === "active"
					? member.emailVerified
					: !member.emailVerified);

			return matchesRole && matchesStatus;
		});
	}, [data?.members, roleFilter, statusFilter]);

	// The rows after the local filters and the search. Bulk actions and the
	// toolbar count both use this list, so a selected row hidden by a filter can
	// never be acted on.
	const visibleMembers = useMemo(
		() =>
			filteredMembers.filter((member) => matchesMemberSearch(member, search)),
		[filteredMembers, search],
	);

	const selectedMembers = useMemo(
		() => visibleMembers.filter((member) => selected.has(member.id)),
		[visibleMembers, selected],
	);

	// Pagination is local because a workspace is capped at 100 members, so the
	// whole list is already in memory.
	const pageSize = pagination.pageSize;
	const totalMembers = visibleMembers.length;
	const totalPages = Math.max(1, Math.ceil(totalMembers / pageSize));
	const pageIndex = Math.min(pagination.pageIndex, totalPages - 1);

	// A removal can shrink the list below the current page. Keep the state in
	// range instead of showing an empty page.
	useEffect(() => {
		if (pagination.pageIndex > totalPages - 1) {
			setPagination((prev) => ({
				...prev,
				pageIndex: Math.max(0, totalPages - 1),
			}));
		}
	}, [pagination.pageIndex, totalPages]);

	/**
	 * Stable callbacks for the table columns.
	 *
	 * Why useCallback here: the column definitions are memoised on these two
	 * functions. If they changed on every render, every checkbox click would
	 * rebuild the whole TanStack column model and re-render every row, which is
	 * what made selection feel laggy.
	 */
	// The toolbar and the column headers share one sorting state, so changing
	// either updates the other.
	const sortField = (sorting[0]?.id ?? "joined") as
		| "member"
		| "role"
		| "joined";
	const sortDirection: "asc" | "desc" = sorting[0]?.desc ? "desc" : "asc";

	const handleSortFieldChange = useCallback(
		(field: "member" | "role" | "joined") => {
			setSorting([{ id: field, desc: sortDirection === "desc" }]);
		},
		[sortDirection],
	);
	const mutateMemberRole = updateRole.mutate;
	const handleRoleChange = useCallback(
		(member: MemberRow, role: "member" | "admin" | "owner") => {
			// Owner is destructive enough to deserve its own confirmation.
			if (role === "owner") {
				setPendingOwner(member);
				return;
			}

			mutateMemberRole(
				{ memberId: member.id, role },
				{
					onError: (error) => {
						toast.error(
							error instanceof Error
								? error.message
								: "Could not change that role.",
						);
					},
				},
			);
		},
		[mutateMemberRole],
	);
	const handleRemoveMember = useCallback((membersToRemove: MemberRow[]) => {
		setRemoveTargets(membersToRemove);
	}, []);

	if (membersQuery.isPending) {
		return <MembersSkeleton />;
	}

	if (membersQuery.isError || !data) {
		return (
			<div
				role="alert"
				className="mx-auto flex w-full max-w-3xl flex-col items-start gap-3 border border-danger bg-danger-bg p-4"
			>
				<p className="text-sm text-danger">
					{membersQuery.error instanceof Error
						? membersQuery.error.message
						: "Could not load the members."}
				</p>
				<Button
					variant="outline"
					onPress={() => {
						void membersQuery.refetch();
					}}
				>
					<RefreshCwIcon aria-hidden />
					Try again
				</Button>
			</div>
		);
	}

	const { viewer, counts, limits, pendingInvitationCount } = data;
	// Captured after the guard so the handlers below do not need a repeated
	// undefined check.
	const organizationId = data.organizationId;

	async function handleBulkRole(role: "member" | "admin") {
		if (selectedMembers.length === 0) return;

		const operation = beginOrganizationOperation({
			organizationId,
			organizationSlug: orgSlug,
			reason: `Changing roles for ${selectedMembers.length} member${
				selectedMembers.length === 1 ? "" : "s"
			}`,
		});

		try {
			const result = await bulkRole.mutateAsync({
				memberIds: selectedMembers.map((member) => member.id),
				role,
			});

			const updated = result.results.filter(
				(item) => item.status === "updated",
			).length;
			const skipped = result.results.length - updated;

			if (updated > 0) {
				toast.success(`${updated} role${updated === 1 ? "" : "s"} updated.`);
			}

			if (skipped > 0) {
				toast.warning(`${skipped} member${skipped === 1 ? "" : "s"} skipped.`, {
					description: "Only an owner can change an owner or another admin.",
				});
			}

			setSelected(new Set());
		} catch (error) {
			toast.error(
				error instanceof Error
					? error.message
					: "Could not change those roles.",
			);
		} finally {
			operation.end();
		}
	}

	async function confirmOwnerPromotion() {
		if (!pendingOwner) return;

		try {
			await updateRole.mutateAsync({
				memberId: pendingOwner.id,
				role: "owner",
			});
			setPendingOwner(null);
		} catch (error) {
			toast.error(
				error instanceof Error
					? error.message
					: "Could not promote that member.",
			);
		}
	}

	return (
		<div className="mx-auto flex w-full max-w-5xl flex-col gap-6 lg:h-full lg:min-h-0">
			<header className="flex shrink-0 flex-col gap-2">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div className="flex flex-wrap items-center gap-3">
						<h1 className="text-2xl font-bold text-app-text">Members</h1>
						<RoleChip role={viewer.role} />
					</div>
					{viewer.canManage && (
						<Button onPress={() => setInviteOpen(true)}>
							<UserPlusIcon data-icon="inline-start" />
							Invite members
						</Button>
					)}
				</div>
				<p className="text-app-text-muted">
					Control who can access this workspace and what they are allowed to do.
				</p>
			</header>

			<div className="grid shrink-0 grid-cols-2 gap-3 lg:grid-cols-4">
				<SummaryStat label="Members" value={String(counts.members)} />
				<SummaryStat label="Admins" value={String(counts.admins)} />
				<SummaryStat label="Owners" value={String(counts.owners)} />
				<SummaryStat
					label="Seats used"
					value={`${counts.total} of ${limits.membership}`}
				/>
			</div>

			{viewer.canManage && pendingInvitationCount !== null && (
				<Link
					to="/$orgSlug/settings/invitations"
					params={{ orgSlug }}
					search={DEFAULT_INVITATIONS_SEARCH}
					className="flex shrink-0 items-center justify-between gap-2 border border-app-border bg-app-panel-subtle px-3 py-2 text-sm text-app-text transition-colors hover:bg-app-selected"
				>
					<span>
						{pendingInvitationCount} pending invitation
						{pendingInvitationCount === 1 ? "" : "s"}
					</span>
					<span className="inline-flex items-center gap-1 text-app-text-muted">
						Review invitations
						<ArrowRightIcon className="size-3.5" aria-hidden />
					</span>
				</Link>
			)}

			{/*
			 * The table is capped, so a long member list does not stretch the
			 * page. The column header stays sticky inside the card.
			 */}
			<div className="shrink-0">
				<MembersToolbar
					search={search}
					onSearchChange={setSearch}
					roleFilter={roleFilter}
					onRoleFilterChange={setRoleFilter}
					statusFilter={statusFilter}
					onStatusFilterChange={setStatusFilter}
					sortField={sortField}
					onSortFieldChange={handleSortFieldChange}
					visibleCount={visibleMembers.length}
					totalCount={counts.total}
					canManage={viewer.canManage}
					selectedCount={selectedMembers.length}
					onClearSelection={() => setSelected(new Set())}
					onBulkRole={handleBulkRole}
					onBulkRemove={() => setRemoveTargets(selectedMembers)}
					onRefresh={() => {
						void membersQuery.refetch();
					}}
					isRefreshing={membersQuery.isFetching}
				/>
			</div>

			{/*
			 * At lg the table fills exactly the height left after the header,
			 * summary and toolbar, so its min and max are the same available
			 * space. Below lg it keeps a 40dvh floor and a 60dvh cap. The
			 * column header sticks and the footer stays below the scroll area.
			 */}
			<section className="relative flex flex-col border border-app-border bg-app-panel lg:min-h-0 lg:flex-1">
				<div
					className="min-h-[40dvh] max-h-[60dvh] overflow-auto lg:min-h-0 lg:max-h-none lg:flex-1"
					aria-busy={membersQuery.isFetching}
				>
					<MembersTable
						members={filteredMembers}
						viewerRole={viewer.role}
						canManage={viewer.canManage}
						ownerCount={counts.owners}
						selected={selected}
						onSelectedChange={setSelected}
						sorting={sorting}
						onSortingChange={setSorting}
						globalFilter={search}
						pagination={pagination}
						onPaginationChange={setPagination}
						onRoleChange={handleRoleChange}
						onRemove={handleRemoveMember}
					/>
				</div>

				<div className="shrink-0 border-t border-app-border p-3">
					<TablePagination
						page={pageIndex + 1}
						pageSize={pageSize}
						total={totalMembers}
						totalPages={totalPages}
						hasNext={pageIndex < totalPages - 1}
						hasPrevious={pageIndex > 0}
						onPageChange={(page) => {
							setSelected(new Set());
							setPagination((prev) => ({
								...prev,
								pageIndex: page - 1,
							}));
						}}
						onPageSizeChange={(size) => {
							setSelected(new Set());
							setPagination({ pageIndex: 0, pageSize: size });
						}}
					/>
				</div>

				{membersQuery.isFetching && <TableLoader label="Loading members..." />}
			</section>

			<InviteMembersDialog
				organizationId={organizationId}
				orgSlug={orgSlug}
				viewerRole={viewer.role}
				isOpen={inviteOpen}
				onOpenChange={setInviteOpen}
			/>

			<RemoveMembersDialog
				organizationId={organizationId}
				orgSlug={orgSlug}
				isOpen={removeTargets.length > 0}
				onOpenChange={(open) => {
					if (!open) setRemoveTargets([]);
				}}
				members={removeTargets}
				viewerRole={viewer.role}
				ownerCount={counts.owners}
				onRemoved={() => {
					setRemoveTargets([]);
					setSelected(new Set());
				}}
			/>

			<Dialog
				isOpen={Boolean(pendingOwner)}
				onOpenChange={(open) => {
					if (!open) setPendingOwner(null);
				}}
			>
				<DialogHeader>
					<DialogTitle>
						Make {pendingOwner?.name ?? "this member"} an owner?
					</DialogTitle>
				</DialogHeader>
				<DialogDescription>
					Owners can change workspace settings, manage every member and delete
					the organization. Only do this for someone you trust completely.
				</DialogDescription>
				<DialogFooter>
					<Button
						variant="outline"
						onPress={() => setPendingOwner(null)}
						isDisabled={updateRole.isPending}
					>
						Cancel
					</Button>
					<Button
						loading={updateRole.isPending}
						onPress={confirmOwnerPromotion}
					>
						<CrownIcon aria-hidden />
						Make owner
					</Button>
				</DialogFooter>
			</Dialog>
		</div>
	);
}

/** One number in the summary strip. */
function SummaryStat({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex flex-col gap-1 border border-app-border bg-app-panel p-3">
			<span className="text-xs font-semibold tracking-widest text-app-text-muted uppercase">
				{label}
			</span>
			<span className="text-lg font-bold text-app-text">{value}</span>
		</div>
	);
}

/** Loading shape that matches the real page, so it does not jump. */
function MembersSkeleton() {
	return (
		<div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
			<div className="flex flex-col gap-2">
				<Skeleton className="h-8 w-40" />
				<Skeleton className="h-4 w-96" />
			</div>
			<div className="grid gap-3 sm:grid-cols-3">
				<Skeleton className="h-20 w-full" />
				<Skeleton className="h-20 w-full" />
				<Skeleton className="h-20 w-full" />
			</div>
			<Skeleton className="h-12 w-full" />
			<Skeleton className="h-80 w-full" />
		</div>
	);
}
