/**
 * Opening a notification that belongs to another workspace.
 *
 * Why this exists: a notification href always names the workspace that produced
 * it. The session holds exactly one active organization, so the shell treats any
 * other slug as a stale link and replaces it with the active workspace. That is
 * right for a bookmark and wrong for a notification the person just clicked, and
 * before this hook the alert was discarded and stayed unread.
 *
 * The link is therefore resolved before the redirect runs: same workspace is
 * left alone, a workspace the person belongs to is switched into through the
 * normal guarded switch, and anything else falls back to the active workspace
 * without an error. This hook is the only owner of the mark-read action for an
 * external click, so a click cannot be counted twice or counted in the wrong
 * workspace.
 *
 * Used by: routes/_app.tsx.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

import { authClient } from "#/features/auth/client";
import { useSwitchOrganization } from "#/features/organization/switch";
import { markNotificationRead } from "./api";
import { notificationSummaryKey, notificationsKey } from "./hooks";

/** An organization as the auth client lists it. */
export type NotificationLinkOrganization = {
	id: string;
	name: string;
	slug: string;
};

/** What to do with a `?notification=` click. */
export type NotificationLinkDecision =
	| { kind: "none" }
	| { kind: "wait" }
	| { kind: "same" }
	| { kind: "switch"; organization: NotificationLinkOrganization }
	| { kind: "unknown" };

/** Read the notification id from a query string, or null. */
export function readNotificationId(search: string): string | null {
	if (search.length === 0) return null;

	const value = new URLSearchParams(search).get("notification");

	if (!value) return null;

	// The id is a UUID. A long or empty value is not something this app wrote,
	// so it is ignored rather than sent to the API.
	return value.length > 0 && value.length <= 64 ? value : null;
}

/**
 * Decide what a notification link needs.
 *
 * Pure on purpose: the three real cases (same workspace, another workspace the
 * person belongs to, a workspace they do not) are the whole contract, and they
 * are easier to pin in a test than behind a router.
 */
export function decideNotificationLink(input: {
	notificationId: string | null;
	urlSlug?: string;
	activeSlug?: string | null;
	organizations?: ReadonlyArray<NotificationLinkOrganization> | null;
	organizationsPending: boolean;
}): NotificationLinkDecision {
	if (!input.notificationId) return { kind: "none" };
	if (!input.urlSlug) return { kind: "none" };

	// The active organization is one fetch away. Until it arrives there is
	// nothing to compare against, and the existing workspace guard already
	// covers that window.
	if (!input.activeSlug) return { kind: "none" };

	if (input.urlSlug === input.activeSlug) return { kind: "same" };

	if (!input.organizations) {
		return input.organizationsPending ? { kind: "wait" } : { kind: "unknown" };
	}

	const organization = input.organizations.find(
		(item) => item.slug === input.urlSlug,
	);

	return organization ? { kind: "switch", organization } : { kind: "unknown" };
}

/**
 * Handle a notification click for the whole app shell.
 *
 * `holdRedirect` is true while a switch is needed or in flight. The shell must
 * not render or redirect during that window, otherwise the workspace guard
 * navigates to the old workspace and throws the link away.
 */
export function useNotificationLink(input: {
	urlSlug?: string;
	activeSlug: string | null;
}): { holdRedirect: boolean } {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const switchOrganization = useSwitchOrganization();
	const { data: organizations, isPending } = authClient.useListOrganizations();

	// Read the query once. The parameter is removed immediately, so a later
	// render must not decide against a URL that no longer carries it.
	const [notificationId] = useState<string | null>(() =>
		typeof window === "undefined"
			? null
			: readNotificationId(window.location.search),
	);

	const [switching, setSwitching] = useState(false);
	// A blocked or failed switch must stop holding the shell, otherwise the
	// guard can never send the person back to their active workspace.
	const [abandoned, setAbandoned] = useState(false);
	const handled = useRef(false);

	const decision = decideNotificationLink({
		notificationId,
		urlSlug: input.urlSlug,
		activeSlug: input.activeSlug,
		organizations,
		organizationsPending: isPending,
	});

	/** Mark the row read in the workspace that produced it. */
	const markRead = useCallback(
		async (organizationSlug: string, id: string) => {
			try {
				await markNotificationRead(organizationSlug, id);
				void queryClient.invalidateQueries({
					queryKey: notificationSummaryKey(organizationSlug),
				});
				void queryClient.invalidateQueries({
					queryKey: [...notificationsKey(organizationSlug), "list"],
				});
			} catch {
				// The alert already opened. A failed mark-read only costs a badge.
			}
		},
		[queryClient],
	);

	useEffect(() => {
		if (handled.current) return;
		if (decision.kind === "none" || decision.kind === "wait") return;

		handled.current = true;

		// Drop the parameter first, so a reload or a later navigation cannot
		// replay the click.
		const target = new URL(window.location.href);
		target.searchParams.delete("notification");
		window.history.replaceState({}, "", target.toString());

		if (decision.kind === "same") {
			if (input.activeSlug && notificationId) {
				void markRead(input.activeSlug, notificationId);
			}
			return;
		}

		// The person is not a member of that workspace. Fall back to the active
		// one, which the normal guard does, and leave the row unread because the
		// target was never opened.
		if (decision.kind === "unknown") return;

		if (decision.kind !== "switch" || !notificationId) return;

		setSwitching(true);

		void (async () => {
			try {
				const result = await switchOrganization({
					organizationId: decision.organization.id,
					organizationSlug: decision.organization.slug,
					organizationName: decision.organization.name,
				});

				// A blocked switch has already opened the dialog. Do not navigate.
				if (result.status !== "switched") {
					setAbandoned(true);
					return;
				}

				navigate({
					to: target.pathname,
					search: Object.fromEntries(target.searchParams),
				} as never);

				await markRead(decision.organization.slug, notificationId);
			} catch {
				// The switch failed. The guard sends the person to the active
				// workspace, which is the same outcome as an unknown workspace.
				setAbandoned(true);
			} finally {
				setSwitching(false);
			}
		})();
	}, [
		decision,
		input.activeSlug,
		notificationId,
		navigate,
		switchOrganization,
		markRead,
	]);

	return {
		holdRedirect:
			!abandoned &&
			(switching ||
				decision.kind === "switch" ||
				// The organization list is loading while the click needs it.
				(decision.kind === "wait" && notificationId !== null)),
	};
}
