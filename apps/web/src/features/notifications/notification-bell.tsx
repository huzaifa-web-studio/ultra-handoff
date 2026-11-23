"use client";

/**
 * The workspace notification bell.
 *
 * Lives in the app header, outside every project, so it can carry a mention
 * from any project and the invite accepted while the reader was on settings.
 *
 * Why the popover shows only a short page: the full history lives on its own
 * page. The bell is for the last few things and one click to the rest.
 *
 * Used by: components/app-sidebar/app-header.tsx.
 */

import { Button } from "@org/ui/components/button";
import { Popover, PopoverTrigger } from "@org/ui/components/popover";
import { useNavigate } from "@tanstack/react-router";
import { BellIcon, CheckCheckIcon } from "lucide-react";
import { useState } from "react";

import {
	useMarkAllNotificationsRead,
	useNotificationSummary,
	useNotifications,
} from "./hooks";
import { NotificationItem } from "./notification-item";

/** How many rows the popover shows before "View all". */
const BELL_PAGE_SIZE = 8;

export function NotificationBell({ orgSlug }: { orgSlug: string }) {
	const navigate = useNavigate();
	const [open, setOpen] = useState(false);
	const summary = useNotificationSummary(orgSlug);
	const list = useNotifications(orgSlug, "all", { enabled: open });
	const markAll = useMarkAllNotificationsRead(orgSlug);

	const unread = summary.data?.unread ?? 0;
	const notifications =
		list.data?.pages.flatMap((page) => page.notifications) ?? [];
	const visible = notifications.slice(0, BELL_PAGE_SIZE);

	function markEverythingRead() {
		// The popover only knows the first page. "Mark all" means every unread
		// row that exists now, so the cutoff is now, not the newest loaded row.
		markAll.mutate(new Date().toISOString());
	}

	return (
		<PopoverTrigger isOpen={open} onOpenChange={setOpen}>
			<Button
				variant="ghost"
				size="icon"
				aria-label={
					unread > 0 ? `Notifications, ${unread} unread` : "Notifications"
				}
				className="relative"
			>
				<BellIcon aria-hidden />
				{unread > 0 ? (
					<span className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center bg-app-attention px-1 text-[0.6rem] font-semibold text-app-attention-text tabular-nums">
						{unread > 99 ? "99+" : unread}
					</span>
				) : null}
			</Button>

			<Popover className="w-96 gap-0 p-0">
				<div className="flex items-center justify-between gap-3 border-b border-app-border px-4 py-3">
					<span className="text-xs font-semibold tracking-widest text-app-text-muted uppercase">
						Notifications
					</span>
					<Button
						variant="ghost"
						size="xs"
						isDisabled={markAll.isPending || unread === 0}
						onPress={markEverythingRead}
					>
						<CheckCheckIcon aria-hidden />
						Mark all read
					</Button>
				</div>

				<div className="max-h-96 overflow-y-auto">
					{list.isPending ? (
						<p className="p-4 text-xs text-app-text-muted">
							Loading notifications...
						</p>
					) : list.isError ? (
						<div className="flex flex-col gap-2 p-4">
							<p role="alert" className="text-xs text-danger">
								{list.error instanceof Error
									? list.error.message
									: "Could not load your notifications."}
							</p>
							<Button
								variant="outline"
								size="xs"
								onPress={() => void list.refetch()}
							>
								Try again
							</Button>
						</div>
					) : visible.length === 0 ? (
						<p className="p-4 text-xs text-app-text-muted">
							You are all caught up.
						</p>
					) : (
						visible.map((notification) => (
							<NotificationItem
								key={notification.id}
								notification={notification}
								orgSlug={orgSlug}
								onNavigate={() => setOpen(false)}
							/>
						))
					)}
				</div>

				<div className="border-t border-app-border p-2">
					<Button
						variant="ghost"
						size="sm"
						className="w-full"
						onPress={() => {
							setOpen(false);
							navigate({ to: "/$orgSlug/notifications", params: { orgSlug } });
						}}
					>
						View all
					</Button>
				</div>
			</Popover>
		</PopoverTrigger>
	);
}
