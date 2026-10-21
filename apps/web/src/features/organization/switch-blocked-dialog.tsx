/**
 * Blocked organization switch dialog.
 *
 * Why a global dialog: the same safety rule applies to the organization
 * switcher, leaving and deleting. Mounting one dialog in the app shell keeps
 * the copy and the accessibility behaviour consistent everywhere.
 *
 * Used by: src/routes/_app.tsx.
 */

import {
	Dialog,
	DialogClose,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@org/ui/components/dialog";
import { useSelector } from "@tanstack/react-store";

import {
	closeSwitchBlockedDialog,
	switchBlockedStore,
} from "./switch-blocked-store";

export function SwitchBlockedDialog() {
	const { isOpen, title, reason, targetName } = useSelector(switchBlockedStore);

	return (
		<Dialog
			isOpen={isOpen}
			onOpenChange={(open) => {
				if (!open) closeSwitchBlockedDialog();
			}}
			isDismissable
			showCloseButton
		>
			{/*
			 * pr-12 keeps the long uppercase title clear of the absolutely
			 * positioned close button in the top right corner.
			 */}
			<DialogHeader className="pr-12">
				<DialogTitle>{title}</DialogTitle>
			</DialogHeader>

			<DialogDescription>
				{reason ?? "An operation is still running in this workspace."}
				{targetName
					? ` Switching to ${targetName} now could interrupt it.`
					: " Leaving now could interrupt it."}
			</DialogDescription>

			<p className="text-sm text-app-text-muted">
				Wait for the operation to finish, then try again.
			</p>

			<DialogFooter>
				<DialogClose>Stay here</DialogClose>
			</DialogFooter>
		</Dialog>
	);
}
