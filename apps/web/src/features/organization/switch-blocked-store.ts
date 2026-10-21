/**
 * State for the "operation still running" dialog.
 *
 * Why a store: the guard is evaluated in event handlers (switcher, leave,
 * delete) while the dialog itself is mounted once in the app shell. A tiny
 * store lets any caller open it without prop drilling or a second dialog per
 * screen.
 *
 * Used by: switch.ts, leave-card.tsx, delete-card.tsx and the dialog mounted
 * in src/routes/_app.tsx.
 */

import { Store } from "@tanstack/store";

export type SwitchBlockedState = {
	isOpen: boolean;
	title: string;
	reason: string | null;
	/** Workspace the user tried to switch to, when there is one. */
	targetName: string | null;
};

const DEFAULT_TITLE = "Can't switch right now";

export const switchBlockedStore = new Store<SwitchBlockedState>({
	isOpen: false,
	title: DEFAULT_TITLE,
	reason: null,
	targetName: null,
});

/** Open the dialog with the operation's user facing reason. */
export function openSwitchBlockedDialog(input: {
	reason: string;
	title?: string;
	targetName?: string | null;
}): void {
	switchBlockedStore.setState(() => ({
		isOpen: true,
		title: input.title ?? DEFAULT_TITLE,
		reason: input.reason,
		targetName: input.targetName ?? null,
	}));
}

/** Close the dialog and forget the previous reason. */
export function closeSwitchBlockedDialog(): void {
	switchBlockedStore.setState(() => ({
		isOpen: false,
		title: DEFAULT_TITLE,
		reason: null,
		targetName: null,
	}));
}
