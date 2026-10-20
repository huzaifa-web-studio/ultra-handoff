import { Dialog, DialogHeader, DialogTitle } from "@org/ui/components/dialog";
import { useEffect, useState } from "react";
import { authClient } from "#/features/auth/client";
import { CreateOrganizationForm } from "./create-form";

export function OrganizationDialog({
	open: openProp,
	onOpenChange,
	onSuccess,
}: {
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	onSuccess?: (organizationId: string) => void;
} = {}) {
	const { data: session } = authClient.useSession();
	const needsOrg = !!session?.user && !session.session?.activeOrganizationId;
	const [internalOpen, setInternalOpen] = useState(needsOrg);

	const isControlled = openProp !== undefined;
	const open = isControlled ? openProp : internalOpen;
	const setOpen = (value: boolean) => {
		if (isControlled) {
			onOpenChange?.(value);
		} else {
			setInternalOpen(value);
		}
	};

	useEffect(() => {
		if (!isControlled) {
			setInternalOpen(needsOrg);
		}
	}, [needsOrg, isControlled]);

	return (
		<Dialog
			isOpen={open}
			onOpenChange={setOpen}
			isDismissable={isControlled}
			showCloseButton={isControlled}
		>
			<DialogHeader>
				<DialogTitle>Create your organization</DialogTitle>
			</DialogHeader>
			<CreateOrganizationForm
				onSuccess={(orgId) => {
					onSuccess?.(orgId);
					setOpen(false);
				}}
			/>
		</Dialog>
	);
}
