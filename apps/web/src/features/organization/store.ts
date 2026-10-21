/**
 * State for the create-organization dialog.
 *
 * Why a store: the dialog is opened from two places (the prompt that appears
 * when a user without an organization lands on the home page, and the centered
 * "Create organization" button on that same page), and it has to remember that
 * the user already dismissed it so the prompt does not reopen in the same
 * visit.
 *
 * Why the dismissal is not persisted: a reload is treated as a fresh visit,
 * so a user without an organization always meets the prompt again.
 *
 * Used by: features/organization/organization-dialog.tsx,
 * features/organization/empty-state.tsx, routes/index.tsx and
 * components/root-header.tsx.
 */

import { Store } from "@tanstack/store";

export type OrganizationDialogState = {
	/** Whether the dialog is currently on screen. */
	isOpen: boolean;
	/**
	 * True once the user closed the prompt without creating an organization.
	 * The home page then shows the simple state with the centered button
	 * instead of the prompt.
	 */
	wasDismissed: boolean;
};

export const organizationDialogStore = new Store<OrganizationDialogState>({
	isOpen: false,
	wasDismissed: false,
});

/** Open the create-organization dialog. */
export function openOrganizationDialog() {
	organizationDialogStore.setState((state) => ({ ...state, isOpen: true }));
}

/**
 * Close the dialog.
 *
 * The dismissal is remembered for the current visit so the prompt does not
 * reopen behind the user's back. A reload clears it.
 */
export function closeOrganizationDialog() {
	organizationDialogStore.setState((state) => ({
		...state,
		isOpen: false,
		wasDismissed: true,
	}));
}

/**
 * Forget the previous dismissal.
 *
 * Used after sign out and after an organization is created, so the next
 * session starts from a clean prompt state.
 */
export function resetOrganizationDialog() {
	organizationDialogStore.setState(() => ({
		isOpen: false,
		wasDismissed: false,
	}));
}
