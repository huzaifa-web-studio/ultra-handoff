"use client";

/**
 * One notification row.
 *
 * The server sends the rendered title, body and href, so the bell, the page and
 * an operating system alert always say the same thing. This component only
 * chooses the icon, the unread dot and the click behaviour.
 *
 * Used by: notification-bell.tsx and the notifications page.
 */

import { useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import {
	AtSignIcon,
	BellIcon,
	CalendarClockIcon,
	CircleAlertIcon,
	FlagIcon,
	GitPullRequestIcon,
	LockIcon,
	MessageSquareIcon,
	Settings2Icon,
	UnlockIcon,
	UserPlusIcon,
} from "lucide-react";

import { formatDateTime, formatRelativeTime } from "#/lib/date";
import type { NotificationItem as NotificationItemType } from "./api";
import { useMarkNotificationRead } from "./hooks";

/** The icon for one notification type. */
function NotificationIcon({ type }: { type: NotificationItemType["type"] }) {
	const className = "size-4 shrink-0";

	if (type === "mention")
		return <AtSignIcon className={className} aria-hidden />;
	if (type === "comment_reply" || type === "comment_new") {
		return <MessageSquareIcon className={className} aria-hidden />;
	}
	if (type === "milestone_due_soon" || type === "milestone_overdue") {
		return <CalendarClockIcon className={className} aria-hidden />;
	}
	if (type === "change_request_created") {
		return <GitPullRequestIcon className={className} aria-hidden />;
	}
	if (
		type === "change_request_decided" ||
		type === "change_request_withdrawn"
	) {
		return <FlagIcon className={className} aria-hidden />;
	}
	if (type === "scope_locked")
		return <LockIcon className={className} aria-hidden />;
	if (type === "scope_unlocked") {
		return <UnlockIcon className={className} aria-hidden />;
	}
	if (type === "project_member_added" || type === "member_joined") {
		return <UserPlusIcon className={className} aria-hidden />;
	}
	if (type === "project_archived") {
		return <CircleAlertIcon className={className} aria-hidden />;
	}
	if (type === "org_role_changed") {
		return <Settings2Icon className={className} aria-hidden />;
	}

	return <BellIcon className={className} aria-hidden />;
}

export function NotificationItem({
	notification,
	orgSlug,
	onNavigate,
}: {
	notification: NotificationItemType;
	orgSlug: string;
	/** Close the bell or scroll to the top after a click. */
	onNavigate?: () => void;
}) {
	const navigate = useNavigate();
	const markRead = useMarkNotificationRead(orgSlug);
	const unread = notification.readAt === null;

	function open() {
		if (unread) {
			markRead.mutate(notification.id);
		}

		onNavigate?.();

		// The server href can carry the milestone and tab query parameters.
		// Passing the whole string as `to` would treat the query as part of the
		// path, so split it into the router's path and search inputs.
		const target = new URL(notification.href, window.location.origin);

		navigate({
			to: target.pathname,
			search: Object.fromEntries(target.searchParams),
		} as never);
	}

	return (
		<button
			type="button"
			onClick={open}
			className={cn(
				"flex w-full cursor-pointer items-start gap-3 border-b border-app-border px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-app-panel-subtle focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none",
				unread ? "bg-app-panel" : "bg-app-panel-subtle/40",
			)}
		>
			<span className="mt-0.5 text-app-text-muted">
				<NotificationIcon type={notification.type} />
			</span>
			<span className="min-w-0 flex-1">
				<span className="flex items-start gap-2">
					<span className="min-w-0 flex-1 text-sm font-medium text-app-text">
						{notification.title}
					</span>
					{unread ? (
						<>
							<span
								className="mt-1.5 size-2 shrink-0 bg-app-attention"
								aria-hidden
							/>
							<span className="sr-only">Unread</span>
						</>
					) : null}
				</span>
				<span className="mt-0.5 block text-xs text-app-text-muted">
					{notification.body}
				</span>
				<span
					className="mt-1 block text-[0.65rem] text-app-text-muted"
					title={formatDateTime(notification.createdAt)}
				>
					{formatRelativeTime(notification.createdAt)}
				</span>
			</span>
		</button>
	);
}
