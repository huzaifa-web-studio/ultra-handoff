/**
 * The one place that changes the active organization.
 *
 * Why centralised: the switch guard only works if every switch goes through
 * the same check. Keep using this hook instead of calling
 * `authClient.organization.setActive` directly. It also keeps the session,
 * the cross-tab broadcast and the URL in sync.
 *
 * Used by: the organization switcher, the create form, the leave card and the
 * delete card. The future invite acceptance screen must use it too.
 */

import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { authClient } from "#/features/auth/client";
import { broadcastAuth } from "#/features/auth/sync";
import { openSwitchBlockedDialog } from "./switch-blocked-store";
import { getSwitchBlock } from "./switch-guard";

export type SwitchOrganizationInput = {
	organizationId: string;
	organizationSlug: string;
	organizationName?: string;
	/**
	 * Skip the guard. Only for flows where the old organization is already
	 * gone (leave, delete) and there is nothing left to interrupt.
	 */
	force?: boolean;
	/**
	 * The workspace being left. Needed when the active organization has
	 * already been cleared, so other tabs still know which URL to follow.
	 */
	previousOrganizationSlug?: string;
	replace?: boolean;
};

export type SwitchOrganizationResult =
	| { status: "switched" }
	| { status: "blocked" };

export function useSwitchOrganization() {
	const navigate = useNavigate();
	const { data: activeOrganization } = authClient.useActiveOrganization();

	return useCallback(
		async (
			input: SwitchOrganizationInput,
		): Promise<SwitchOrganizationResult> => {
			if (!input.force) {
				const block = getSwitchBlock(
					activeOrganization?.id,
					input.organizationId,
				);

				if (block) {
					openSwitchBlockedDialog({
						reason: block.reason,
						targetName: input.organizationName,
					});
					return { status: "blocked" };
				}
			}

			const { error } = await authClient.organization.setActive({
				organizationId: input.organizationId,
			});

			if (error) {
				throw new Error(
					error.message ?? "Could not switch the active organization.",
				);
			}

			// Refresh the session and the active organization atom before the
			// navigation so the sidebar and the page agree immediately.
			await authClient.getSession();

			const previousSlug =
				input.previousOrganizationSlug ?? activeOrganization?.slug;

			broadcastAuth("auth:org-changed", {
				slug: input.organizationSlug,
				previousSlug,
			});

			navigate({
				to: "/$orgSlug",
				params: { orgSlug: input.organizationSlug },
				replace: input.replace,
			});

			return { status: "switched" };
		},
		[activeOrganization?.id, activeOrganization?.slug, navigate],
	);
}
