/**
 * Queries for the project message room.
 *
 * Why the keys sit under the messaging prefix: the personal realtime provider
 * and the messages feature invalidate `["organization", slug, "messages"]` as
 * one namespace. A project room lives in that namespace even though it renders
 * in a project tab.
 *
 * Used by: features/projects/messages/page.tsx and the project workspace badge.
 */

import { useQuery } from "@tanstack/react-query";

import { messagesKey } from "#/features/messages/keys";
import { ApiRequestError } from "#/lib/api";
import { fetchProjectConversationUnread, openProjectConversation } from "./api";

/**
 * The open room header for one project.
 *
 * Kept under the projects prefix, not the messages prefix, because the open
 * call reconciles membership. A message notification invalidates the messages
 * prefix, and re-running this write on every message would be wasteful.
 */
export function projectConversationKey(orgSlug: string, projectId: string) {
	return [
		"organization",
		orgSlug,
		"projects",
		"conversation",
		projectId,
	] as const;
}

/** The unread count for the project Messages tab. */
export function projectConversationUnreadKey(
	orgSlug: string,
	projectId: string,
) {
	return [...messagesKey(orgSlug), "project-unread", projectId] as const;
}

/** A 403 or 404 is an answer, not a transient failure. */
function retryProjectQuery(failureCount: number, error: unknown): boolean {
	if (
		error instanceof ApiRequestError &&
		(error.status === 403 || error.status === 404)
	) {
		return false;
	}

	return failureCount < 2;
}

/**
 * Open or refresh the project room.
 *
 * The request is an idempotent GET, which is why a query is the right shape for
 * the first visit. The room is created on the server the first time.
 */
export function useProjectConversation(
	orgSlug: string,
	projectId: string | null,
	enabled = true,
) {
	return useQuery({
		queryKey: projectConversationKey(orgSlug, projectId ?? ""),
		queryFn: () => openProjectConversation(orgSlug, projectId ?? ""),
		enabled: enabled && Boolean(orgSlug) && Boolean(projectId),
		staleTime: 20_000,
		// Opening reconciles participants. A focus refetch would repeat that
		// write on every alt-tab, and the header has its own query.
		refetchOnWindowFocus: false,
		retry: retryProjectQuery,
	});
}

/**
 * Read the unread count that drives the tab dot.
 *
 * Deliberately separate from `useProjectConversation`: the workspace wants the
 * dot before the tab is opened, and this endpoint never creates the room.
 */
export function useProjectConversationUnread(
	orgSlug: string,
	projectId: string | null,
) {
	return useQuery({
		queryKey: projectConversationUnreadKey(orgSlug, projectId ?? ""),
		queryFn: () => fetchProjectConversationUnread(orgSlug, projectId ?? ""),
		enabled: Boolean(orgSlug) && Boolean(projectId),
		staleTime: 10_000,
		retry: retryProjectQuery,
	});
}
