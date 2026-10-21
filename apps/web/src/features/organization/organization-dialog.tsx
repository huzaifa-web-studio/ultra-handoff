import { Dialog, DialogHeader, DialogTitle } from "@org/ui/components/dialog";
import { useSelector } from "@tanstack/react-store";
import { CreateOrganizationForm } from "./create-form";
import {
	closeOrganizationDialog,
	organizationDialogStore,
	resetOrganizationDialog,
} from "./store";

/**
 * Create-organization dialog.
 *
 * Why store-backed: open state lives in `organizationDialogStore` so any caller
 * (home page button, organization switcher) just calls
 * `openOrganizationDialog()` and renders `<OrganizationDialog />` once. No
 * controlled props, no open state scattered at call sites.
 *
 * Used by: src/routes/index.tsx, src/components/app-sidebar/organization-switcher.tsx.
 */
export function OrganizationDialog() {
	const { isOpen } = useSelector(organizationDialogStore);
	return (
		<Dialog
			isOpen={isOpen}
			onOpenChange={(open) => {
				if (!open) closeOrganizationDialog();
			}}
			isDismissable
			showCloseButton
		>
			<DialogHeader>
				<DialogTitle>Create your organization</DialogTitle>
			</DialogHeader>
			<CreateOrganizationForm
				onSuccess={() => {
					resetOrganizationDialog();
				}}
			/>
		</Dialog>
	);
}
