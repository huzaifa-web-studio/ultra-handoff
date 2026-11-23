/**
 * Notification queries and mutations.
 *
 * Why every key shares one prefix: the bell, the full page and the project dots
 * all read the same notification feature. One invalidation on a realtime event
 * or a read action updates every surface without a manual cache patch for each.
 *
 * Used by: the bell, the notifications page and the realtime provider.
 */

import {
	type InfiniteData,
	keepPreviousData,
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";

import { ApiRequestError } from "#/lib/api";
import {
	fetchNotificationSummary,
	fetchNotifications,
	fetchProjectUnread,
	markAllNotificationsRead,
	markCommentsRead,
	markNotificationRead,
	type NotificationFilter,
	type NotificationPage,
	type ProjectUnreadResponse,
} from "./api";

/** Every notification query for one workspace. */
export function notificationsKey(orgSlug: string) {
	return ["organization", orgSlug, "notifications"] as const;
}

/** The unread badge and per project dots. */
export function notificationSummaryKey(orgSlug: string) {
	return [...notificationsKey(orgSlug), "summary"] as const;
}

/** One filtered page set. */
export function notificationListKey(
	orgSlug: string,
	filter: NotificationFilter,
) {
	return [...notificationsKey(orgSlug), "list", filter] as const;
}

/** Unread comments for one project. */
export function projectUnreadKey(orgSlug: string, projectId: string) {
	return ["organization", orgSlug, "projects", projectId, "unread"] as const;
}

/** Retry policy: an access or missing answer is not transient. */
function retryNotificationQuery(failureCount: number, error: unknown): boolean {
	if (
		error instanceof ApiRequestError &&
		(error.status === 403 || error.status === 404)
	) {
		return false;
	}

	return failureCount < 2;
}

/** The bell badge. */
export function useNotificationSummary(orgSlug: string) {
	return useQuery({
		queryKey: notificationSummaryKey(orgSlug),
		queryFn: () => fetchNotificationSummary(orgSlug),
		retry: retryNotificationQuery,
		staleTime: 15_000,
		// A safety net for a dropped socket. Realtime normally updates this
		// faster, and a visible tab also refetches on focus by default.
		refetchInterval: 60_000,
	});
}

/** One filtered notification list, paged. */
export function useNotifications(
	orgSlug: string,
	filter: NotificationFilter,
	options?: { enabled?: boolean },
) {
	return useInfiniteQuery({
		queryKey: notificationListKey(orgSlug, filter),
		enabled: options?.enabled ?? true,
		queryFn: ({ pageParam }) =>
			fetchNotifications(orgSlug, {
				cursor: pageParam ?? null,
				filter,
			}),
		initialPageParam: null as string | null,
		getNextPageParam: (last) => last.nextCursor,
		placeholderData: keepPreviousData,
		retry: retryNotificationQuery,
		staleTime: 15_000,
	});
}

/** Mark one notification read and refresh the badge. */
export function useMarkNotificationRead(orgSlug: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (notificationId: string) =>
			markNotificationRead(orgSlug, notificationId),
		onSuccess: (data, notificationId) => {
			queryClient.setQueryData(notificationSummaryKey(orgSlug), (current) =>
				current && data ? { ...current, unread: data.unread } : current,
			);

			/*
			 * Patch the cached pages instead of invalidating the list. Clicking
			 * three rows used to refetch page one three times. The unread view
			 * also drops the row, because it no longer matches that filter, and
			 * every page takes the fresh unread total so the label stays right.
			 */
			const readAt = new Date().toISOString();

			for (const filter of ["all", "unread"] as const) {
				queryClient.setQueryData<InfiniteData<NotificationPage>>(
					notificationListKey(orgSlug, filter),
					(current) => {
						if (!current) return current;

						return {
							...current,
							pages: current.pages.map((page) => ({
								...page,
								unread: data?.unread ?? page.unread,
								notifications: page.notifications
									.filter(
										(row) => filter === "all" || row.id !== notificationId,
									)
									.map((row) =>
										row.id === notificationId && row.readAt === null
											? { ...row, readAt }
											: row,
									),
							})),
						};
					},
				);
			}
		},
	});
}

/** Mark everything up to the newest loaded notification read. */
export function useMarkAllNotificationsRead(orgSlug: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (before: string) => markAllNotificationsRead(orgSlug, before),
		onSuccess: (data) => {
			queryClient.setQueryData(notificationSummaryKey(orgSlug), (current) =>
				current && data ? { ...current, unread: data.unread } : current,
			);
			void queryClient.invalidateQueries({
				queryKey: [...notificationsKey(orgSlug), "list"],
			});
		},
	});
}

/** Unread comments for one project. */
export function useProjectUnread(orgSlug: string, projectId: string) {
	return useQuery({
		queryKey: projectUnreadKey(orgSlug, projectId),
		queryFn: () => fetchProjectUnread(orgSlug, projectId),
		retry: retryNotificationQuery,
		staleTime: 30_000,
	});
}

/** Move the message cursor for one milestone. */
export function useMarkCommentsRead(
	orgSlug: string,
	projectId: string,
	milestoneId: string,
) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (commentIds: string[]) =>
			markCommentsRead(orgSlug, projectId, milestoneId, commentIds),
		onSuccess: (data) => {
			if (!data) return;

			queryClient.setQueryData<ProjectUnreadResponse>(
				projectUnreadKey(orgSlug, projectId),
				(current) => {
					if (!current) return current;

					const previous =
						current.milestones.find((item) => item.milestoneId === milestoneId)
							?.unread ?? 0;
					const delta = Math.max(0, previous - data.unreadTotal);

					return {
						...current,
						total: Math.max(0, current.total - delta),
						milestones: current.milestones.map((item) =>
							item.milestoneId === milestoneId
								? { ...item, unread: data.unreadTotal }
								: item,
						),
					};
				},
			);
			void queryClient.invalidateQueries({
				queryKey: ["organization", orgSlug, "milestones", projectId],
			});
			// Reading a thread also clears its mention and reply notifications,
			// so the bell must not keep its old count.
			void queryClient.invalidateQueries({
				queryKey: notificationsKey(orgSlug),
			});
		},
	});
}
