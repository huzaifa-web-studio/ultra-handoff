/**
 * Workspace notifications page.
 *
 * Why a page rather than only a popover: the bell is a glance, but a week away
 * can produce more rows than a popover should hold. This page pages through
 * everything and offers the desktop alert setting.
 *
 * Used by: the bell's "View all" action and a direct URL.
 */

import { Button } from "@org/ui/components/button";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCheckIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import type { NotificationFilter } from "#/features/notifications/api";
import { DesktopAlertsCard } from "#/features/notifications/desktop-alerts-card";
import {
	useMarkAllNotificationsRead,
	useNotificationSummary,
	useNotifications,
} from "#/features/notifications/hooks";
import { NotificationItem } from "#/features/notifications/notification-item";

export const Route = createFileRoute("/_app/$orgSlug/notifications")({
	component: NotificationsPage,
	staticData: { breadcrumb: "Notifications" },
});

function NotificationsPage() {
	const { orgSlug } = Route.useParams();
	const [filter, setFilter] = useState<NotificationFilter>("all");
	const list = useNotifications(orgSlug, filter);
	const summary = useNotificationSummary(orgSlug);
	const markAll = useMarkAllNotificationsRead(orgSlug);
	const notifications =
		list.data?.pages.flatMap((page) => page.notifications) ?? [];
	const unread = summary.data?.unread ?? 0;

	return (
		<div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
			<div className="flex flex-wrap items-end justify-between gap-3">
				<div>
					<h1 className="font-display text-xl font-semibold text-app-text">
						Notifications
					</h1>
					<p className="mt-1 text-sm text-app-text-muted">
						Mentions, replies, assignments and delivery reminders for this
						workspace.
					</p>
				</div>
				<Button
					variant="outline"
					size="sm"
					isDisabled={markAll.isPending || unread === 0}
					onPress={() => markAll.mutate(new Date().toISOString())}
				>
					<CheckCheckIcon aria-hidden />
					Mark all read
				</Button>
			</div>

			<DesktopAlertsCard />

			<div className="flex items-center gap-1 border-b border-app-border">
				<button
					type="button"
					onClick={() => setFilter("all")}
					aria-pressed={filter === "all"}
					className={`cursor-pointer border-b-2 px-3 py-2 text-xs font-semibold tracking-widest uppercase ${
						filter === "all"
							? "border-app-focus text-app-text"
							: "border-transparent text-app-text-muted"
					}`}
				>
					All
				</button>
				<button
					type="button"
					onClick={() => setFilter("unread")}
					aria-pressed={filter === "unread"}
					className={`cursor-pointer border-b-2 px-3 py-2 text-xs font-semibold tracking-widest uppercase ${
						filter === "unread"
							? "border-app-focus text-app-text"
							: "border-transparent text-app-text-muted"
					}`}
				>
					Unread
					{unread > 0 ? (
						<span className="ml-1.5 bg-app-selected px-1.5 py-0.5 text-[0.6rem] tabular-nums text-app-text">
							{unread}
						</span>
					) : null}
				</button>
			</div>

			<div className="border border-app-border bg-app-panel">
				{list.isPending ? (
					<p className="p-6 text-sm text-app-text-muted">
						Loading notifications...
					</p>
				) : list.isError ? (
					<div className="flex flex-col items-start gap-3 p-6">
						<p role="alert" className="text-sm text-danger">
							{list.error instanceof Error
								? list.error.message
								: "Could not load your notifications."}
						</p>
						<Button
							variant="outline"
							size="sm"
							onPress={() => void list.refetch()}
						>
							<RefreshCwIcon aria-hidden />
							Try again
						</Button>
					</div>
				) : notifications.length === 0 ? (
					<p className="p-6 text-sm text-app-text-muted">
						{filter === "unread"
							? "No unread notifications."
							: "You are all caught up."}
					</p>
				) : (
					<>
						{notifications.map((notification) => (
							<NotificationItem
								key={notification.id}
								notification={notification}
								orgSlug={orgSlug}
							/>
						))}
						{list.hasNextPage ? (
							<div className="border-t border-app-border p-3">
								<Button
									variant="outline"
									size="sm"
									isDisabled={list.isFetchingNextPage}
									onPress={() => void list.fetchNextPage()}
								>
									{list.isFetchingNextPage ? "Loading..." : "Load more"}
								</Button>
							</div>
						) : null}
					</>
				)}
			</div>
		</div>
	);
}
