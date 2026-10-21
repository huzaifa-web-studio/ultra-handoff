/**
 * Invitation history page.
 *
 * Why URL state: page, page size, status, sort and search all live in the
 * search string. A manager can share or reload the view and land on the same
 * page of the same filter. Search is debounced before it reaches the URL so
 * typing does not refetch on every character.
 *
 * Access: only owners and admins. The sidebar hides the link, and the API
 * answers 403 for everyone else. The page renders an access card instead of a
 * table, so a direct URL never leaks counts or emails.
 *
 * Used by: the settings layout at `/$orgSlug/settings/invitations`.
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
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { BanIcon, RefreshCwIcon, UserPlusIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { TableLoader } from "#/components/data-table/table-loader";
import { TablePagination } from "#/components/data-table/table-pagination";
import type {
	InvitationBulkResult,
	InvitationHistoryQuery,
	InvitationRow,
} from "#/features/invitations/api";
import {
	useBulkCancelInvitations,
	useBulkResendInvitations,
	useInvitations,
} from "#/features/invitations/hooks";
import { InvitationsTable } from "#/features/invitations/invitations-table";
import { InvitationsToolbar } from "#/features/invitations/invitations-toolbar";
import { InviteMembersDialog } from "#/features/invitations/invite-members-dialog";
import {
	type InvitationsSearch,
	normalizeInvitationsSearch,
} from "#/features/invitations/search";
import { beginOrganizationOperation } from "#/features/organization/switch-guard";
import { useDebouncedValue } from "#/hooks/use-debounced-value";
import { ApiRequestError } from "#/lib/api";

export const Route = createFileRoute("/_app/$orgSlug/settings/invitations")({
	validateSearch: normalizeInvitationsSearch,
	component: InvitationsPage,
	staticData: { breadcrumb: "Invitations" },
});

/** Short result summary for a bulk or single row action. */
function reportBulk(
	results: InvitationBulkResult[],
	successStatus: "resent" | "canceled",
) {
	const ok = results.filter((result) => result.status === successStatus).length;
	const other = results.length - ok;

	if (ok > 0) {
		toast.success(
			`${ok} invitation${ok === 1 ? "" : "s"} ${
				successStatus === "resent" ? "resent" : "canceled"
			}.`,
		);
	}

	if (other > 0) {
		toast.warning(
			`${other} invitation${other === 1 ? "" : "s"} could not be ${
				successStatus === "resent" ? "resent" : "canceled"
			}.`,
			{
				description: "Check its status and try again.",
			},
		);
	}
}

function InvitationsPage() {
	const { orgSlug } = Route.useParams();
	const search = Route.useSearch();
	const navigate = Route.useNavigate();

	const [searchInput, setSearchInput] = useState(search.search);
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [inviteOpen, setInviteOpen] = useState(false);
	const [inviteEmail, setInviteEmail] = useState<string | undefined>(undefined);
	const [inviteRole, setInviteRole] = useState<"member" | "admin" | undefined>(
		undefined,
	);
	const [cancelIds, setCancelIds] = useState<string[]>([]);

	const resend = useBulkResendInvitations(orgSlug);
	const cancel = useBulkCancelInvitations(orgSlug);
	// Destructured once so the callbacks below stay stable across selection
	// changes. The table columns are memoised on them.
	const resendInvitations = resend.mutateAsync;
	const cancelInvitations = cancel.mutateAsync;

	const debouncedSearch = useDebouncedValue(searchInput, 300);

	// Track what we last pushed so an external URL change (back button, shared
	// link) updates the box without a slow navigation overwriting fresh typing.
	const lastPushedSearch = useRef(search.search);

	// Push the debounced text into the URL. The guard keeps the effect from
	// looping when the URL change comes back as the same value.
	useEffect(() => {
		if (debouncedSearch === search.search) return;

		lastPushedSearch.current = debouncedSearch;
		navigate({
			search: (prev) => ({ ...prev, search: debouncedSearch, page: 1 }),
			replace: true,
		});
	}, [debouncedSearch, search.search, navigate]);

	// Adopt a search value that came from outside this input.
	useEffect(() => {
		if (search.search === lastPushedSearch.current) return;

		lastPushedSearch.current = search.search;
		setSearchInput(search.search);
	}, [search.search]);

	// Selection is scoped to one page and one filter. Acting on a hidden row is
	// never intended, so every navigation clears it. The effect reads no value
	// from the search object; its identity changes are the trigger.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset on every URL change
	useEffect(() => {
		setSelected(new Set());
	}, [
		search.status,
		search.role,
		search.search,
		search.page,
		search.pageSize,
		search.sort,
		search.direction,
	]);

	const query = useMemo<InvitationHistoryQuery>(
		() => ({
			status: search.status,
			role: search.role,
			search: search.search,
			page: search.page,
			pageSize: search.pageSize,
			sort: search.sort,
			direction: search.direction,
		}),
		[
			search.status,
			search.role,
			search.search,
			search.page,
			search.pageSize,
			search.sort,
			search.direction,
		],
	);

	const invitationsQuery = useInvitations(orgSlug, query);
	const data = invitationsQuery.data;

	// When the result set shrinks, the API clamps the page to the last one.
	// Mirror that in the URL so a reload does not ask for an empty page.
	useEffect(() => {
		// While the next page or filter is in flight, the old page's data is
		// still on screen. Syncing from it would fight the navigation that
		// requested the new query.
		if (invitationsQuery.isPlaceholderData) return;

		const page = invitationsQuery.data?.pagination.page;

		if (page && page !== search.page) {
			navigate({ search: (prev) => ({ ...prev, page }), replace: true });
		}
	}, [
		invitationsQuery.data?.pagination.page,
		invitationsQuery.isPlaceholderData,
		search.page,
		navigate,
	]);

	const selectedRows = useMemo(
		() => (data?.items ?? []).filter((row) => selected.has(row.id)),
		[data?.items, selected],
	);

	const updateSearch = useCallback(
		(patch: Partial<InvitationsSearch>) => {
			navigate({
				search: (prev) => ({ ...prev, ...patch }),
				replace: true,
			});
		},
		[navigate],
	);

	const handleResend = useCallback(
		async (ids: string[]) => {
			if (ids.length === 0) return;

			const operation = data?.organizationId
				? beginOrganizationOperation({
						organizationId: data.organizationId,
						organizationSlug: orgSlug,
						reason: `Resending ${ids.length} invitation${
							ids.length === 1 ? "" : "s"
						}`,
					})
				: null;

			try {
				const result = await resendInvitations(ids);
				reportBulk(result.results, "resent");
				setSelected(new Set());
			} catch (error) {
				toast.error(
					error instanceof Error
						? error.message
						: "Could not resend the invitations.",
				);
			} finally {
				operation?.end();
			}
		},
		[data?.organizationId, orgSlug, resendInvitations],
	);

	const handleCancel = useCallback(
		async (ids: string[]) => {
			if (ids.length === 0) return;

			const operation = data?.organizationId
				? beginOrganizationOperation({
						organizationId: data.organizationId,
						organizationSlug: orgSlug,
						reason: `Canceling ${ids.length} invitation${
							ids.length === 1 ? "" : "s"
						}`,
					})
				: null;

			try {
				const result = await cancelInvitations(ids);
				reportBulk(result.results, "canceled");
				setSelected(new Set());
				setCancelIds([]);
			} catch (error) {
				toast.error(
					error instanceof Error
						? error.message
						: "Could not cancel the invitations.",
				);
			} finally {
				operation?.end();
			}
		},
		[data?.organizationId, orgSlug, cancelInvitations],
	);

	const openInvite = useCallback((email?: string, role?: string) => {
		setInviteEmail(email);
		setInviteRole(role === "admin" ? "admin" : role ? "member" : undefined);
		setInviteOpen(true);
	}, []);

	/**
	 * Stable row callbacks for the table columns, so selecting a row does not
	 * rebuild every column definition and re-render every cell.
	 */
	const handleResendOne = useCallback(
		(row: InvitationRow) => {
			void handleResend([row.id]);
		},
		[handleResend],
	);
	const handleCancelOne = useCallback((row: InvitationRow) => {
		setCancelIds([row.id]);
	}, []);
	const handleInviteAgain = useCallback(
		(email: string, role: string) => {
			openInvite(email, role);
		},
		[openInvite],
	);

	if (invitationsQuery.isPending) {
		return <InvitationsSkeleton />;
	}

	if (invitationsQuery.isError || !data) {
		const status =
			invitationsQuery.error instanceof ApiRequestError
				? invitationsQuery.error.status
				: 0;

		if (status === 403) {
			return <InvitationsAccessCard orgSlug={orgSlug} />;
		}

		return (
			<div
				role="alert"
				className="mx-auto flex w-full max-w-3xl flex-col items-start gap-3 border border-danger bg-danger-bg p-4"
			>
				<p className="text-sm text-danger">
					{invitationsQuery.error instanceof Error
						? invitationsQuery.error.message
						: "Could not load the invitations."}
				</p>
				<Button
					variant="outline"
					onPress={() => {
						void invitationsQuery.refetch();
					}}
				>
					<RefreshCwIcon aria-hidden />
					Try again
				</Button>
			</div>
		);
	}

	const emptyMessage = search.search
		? "No invitations match your search."
		: search.status === "all"
			? "No invitations have been sent yet."
			: `No ${search.status} invitations.`;

	return (
		<div className="mx-auto flex w-full max-w-6xl flex-col gap-6 lg:h-full lg:min-h-0">
			<header className="flex shrink-0 flex-col gap-2">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<h1 className="text-2xl font-bold text-app-text">Invitations</h1>
					<Button onPress={() => openInvite()}>
						<UserPlusIcon data-icon="inline-start" />
						Invite members
					</Button>
				</div>
				<p className="text-app-text-muted">
					Invite people and review every invitation this workspace has sent.
				</p>
			</header>

			{/*
			 * The table scrolls inside its own card, so a long list does not
			 * push the page header, filters or search away. The footer sits
			 * outside the scroll area, below the rows.
			 */}
			<div className="shrink-0">
				<InvitationsToolbar
					status={search.status}
					onStatusChange={(status) => updateSearch({ status, page: 1 })}
					roleFilter={search.role}
					onRoleFilterChange={(role) => updateSearch({ role, page: 1 })}
					sortField={search.sort}
					onSortFieldChange={(sort) => updateSearch({ sort, page: 1 })}
					counts={data.counts}
					search={searchInput}
					onSearchChange={setSearchInput}
					selectedCount={selectedRows.length}
					onClearSelection={() => setSelected(new Set())}
					onBulkResend={() => handleResend(selectedRows.map((row) => row.id))}
					onBulkCancel={() => setCancelIds(selectedRows.map((row) => row.id))}
					onRefresh={() => {
						void invitationsQuery.refetch();
					}}
					isRefreshing={invitationsQuery.isFetching}
				/>
			</div>

			{/*
			 * At lg the table fills exactly the height left after the header
			 * and toolbar, so its min and max are the same available space.
			 * Below lg it keeps a 40dvh floor and a 60dvh cap. The column
			 * header sticks and the footer stays below the scroll area.
			 */}
			<section className="relative flex flex-col border border-app-border bg-app-panel lg:min-h-0 lg:flex-1">
				<div
					className="min-h-[40dvh] max-h-[60dvh] overflow-auto lg:min-h-0 lg:max-h-none lg:flex-1"
					aria-busy={invitationsQuery.isFetching}
				>
					<InvitationsTable
						rows={data.items}
						emptyMessage={emptyMessage}
						selected={selected}
						onSelectedChange={setSelected}
						sort={search.sort}
						direction={search.direction}
						onSortChange={(sort, direction) =>
							updateSearch({ sort, direction, page: 1 })
						}
						onResend={handleResendOne}
						onCancel={handleCancelOne}
						onInviteAgain={handleInviteAgain}
					/>
				</div>

				<div className="shrink-0 border-t border-app-border p-3">
					<TablePagination
						page={data.pagination.page}
						pageSize={data.pagination.pageSize}
						total={data.pagination.total}
						totalPages={data.pagination.totalPages}
						hasNext={data.pagination.hasNext}
						hasPrevious={data.pagination.hasPrevious}
						onPageChange={(page) => updateSearch({ page })}
						onPageSizeChange={(pageSize) => updateSearch({ pageSize, page: 1 })}
						disabled={invitationsQuery.isFetching}
					/>
				</div>

				{invitationsQuery.isFetching && (
					<TableLoader label="Loading invitations..." />
				)}
			</section>

			<InviteMembersDialog
				organizationId={data.organizationId}
				orgSlug={orgSlug}
				viewerRole={data.viewer.role}
				isOpen={inviteOpen}
				onOpenChange={(open) => {
					setInviteOpen(open);

					if (!open) {
						setInviteEmail(undefined);
						setInviteRole(undefined);
					}
				}}
				initialEmails={inviteEmail}
				initialRole={inviteRole}
			/>

			<Dialog
				isOpen={cancelIds.length > 0}
				onOpenChange={(open) => {
					if (!open) setCancelIds([]);
				}}
			>
				<DialogHeader>
					<DialogTitle>
						Cancel {cancelIds.length} invitation
						{cancelIds.length === 1 ? "" : "s"}?
					</DialogTitle>
				</DialogHeader>
				<DialogDescription>
					The links stop working immediately. You can invite the same people
					again later.
				</DialogDescription>
				<DialogFooter>
					<Button
						variant="outline"
						onPress={() => setCancelIds([])}
						isDisabled={cancel.isPending}
					>
						Back
					</Button>
					<Button
						variant="destructive"
						loading={cancel.isPending}
						onPress={() => handleCancel(cancelIds)}
					>
						<BanIcon aria-hidden />
						Cancel invitations
					</Button>
				</DialogFooter>
			</Dialog>
		</div>
	);
}

/** Plain members never see invitation data, even by URL. */
function InvitationsAccessCard({ orgSlug }: { orgSlug: string }) {
	const navigate = useNavigate();

	return (
		<div className="mx-auto flex w-full max-w-3xl flex-col items-start gap-3 border border-app-border bg-app-panel p-6">
			<h1 className="text-xl font-bold text-app-text">Invitations</h1>
			<p className="text-sm text-app-text-muted">
				Only owners and admins can see invitations for this workspace. Ask an
				owner if you need access.
			</p>
			<Button
				variant="outline"
				onPress={() =>
					navigate({
						to: "/$orgSlug/settings/members",
						params: { orgSlug },
					})
				}
			>
				Back to members
			</Button>
		</div>
	);
}

/** Loading shape that matches the real page. */
function InvitationsSkeleton() {
	return (
		<div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
			<div className="flex flex-col gap-2">
				<Skeleton className="h-8 w-48" />
				<Skeleton className="h-4 w-96" />
			</div>
			<Skeleton className="h-10 w-full" />
			<Skeleton className="h-10 w-2/3" />
			<Skeleton className="h-80 w-full" />
		</div>
	);
}
