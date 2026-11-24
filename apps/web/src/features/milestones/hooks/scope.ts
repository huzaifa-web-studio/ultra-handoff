/**
 * Milestone scope entry hooks.
 *
 * Why this file: a scope entry has its own detail key and update path, separate
 * from the milestone document. Keeping it apart means opening a scope tab does
 * not pull the whole detail.
 *
 * Used by: the scope tabs and the milestone panel.
 */

import {
	type QueryClient,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import {
	fetchMilestoneScopeEntry,
	type MilestoneDetailResponse,
	type MilestoneScopeEntry,
	type MilestoneScopeEntrySummary,
	updateMilestoneScopeEntry,
} from "../api";
import { milestoneDetailKey, milestonesKey, retryMilestoneQuery } from "./keys";

export function milestoneScopeEntryKey(
	orgSlug: string,
	projectId: string,
	milestoneId: string,
	entryId: string,
) {
	return [
		...milestonesKey(orgSlug, projectId),
		"scope",
		milestoneId,
		entryId,
	] as const;
}

/**
 * Load one scope section.
 *
 * The detail response carries metadata only, so a frozen round costs nothing
 * until it is expanded. `enabled` is how the caller keeps a collapsed card from
 * making a request.
 */
export function useMilestoneScopeEntry(
	orgSlug: string,
	projectId: string,
	milestoneId: string,
	entryId: string,
	options?: { enabled?: boolean },
) {
	return useQuery({
		queryKey: milestoneScopeEntryKey(orgSlug, projectId, milestoneId, entryId),
		queryFn: () =>
			fetchMilestoneScopeEntry(orgSlug, projectId, milestoneId, entryId),
		enabled:
			Boolean(orgSlug) &&
			Boolean(projectId) &&
			Boolean(milestoneId) &&
			Boolean(entryId) &&
			(options?.enabled ?? true),
		// A frozen round never changes, so the body is safe to keep.
		staleTime: 60_000,
		retry: retryMilestoneQuery,
	});
}

/** Merge one saved section back into the detail metadata and the body cache. */
function syncScopeEntry(
	queryClient: QueryClient,
	orgSlug: string,
	projectId: string,
	milestoneId: string,
	entry: MilestoneScopeEntry,
): void {
	const { body: _body, ...summary } = entry;
	const metadata: MilestoneScopeEntrySummary = summary;

	queryClient.setQueryData<MilestoneScopeEntry>(
		milestoneScopeEntryKey(orgSlug, projectId, milestoneId, entry.id),
		entry,
	);

	queryClient.setQueryData<MilestoneDetailResponse>(
		milestoneDetailKey(orgSlug, projectId, milestoneId),
		(current) =>
			current
				? {
						...current,
						milestone: {
							...current.milestone,
							scopeEntries: current.milestone.scopeEntries.map((row) =>
								row.id === metadata.id ? metadata : row,
							),
						},
					}
				: current,
	);
}

/**
 * Save one scope section.
 *
 * The server returns only the section, so the milestone detail cache is patched
 * rather than replaced. That is what keeps autosave in a long test round from
 * refetching the whole milestone on every debounce.
 */
export function useUpdateMilestoneScopeEntry(
	orgSlug: string,
	projectId: string,
) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: ({
			milestoneId,
			entryId,
			patch,
		}: {
			milestoneId: string;
			entryId: string;
			patch: { title?: string; body?: unknown };
		}) =>
			updateMilestoneScopeEntry(
				orgSlug,
				projectId,
				milestoneId,
				entryId,
				patch,
			),
		onSuccess: (entry, variables) => {
			syncScopeEntry(
				queryClient,
				orgSlug,
				projectId,
				variables.milestoneId,
				entry,
			);
		},
		onError: (error) => {
			toast.error(
				error instanceof Error
					? error.message
					: "Could not save the scope section.",
			);
		},
	});
}
