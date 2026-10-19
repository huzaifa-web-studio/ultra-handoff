import { Dialog, DialogHeader, DialogTitle } from "@org/ui/components/dialog";
import { useEffect, useState } from "react";
import { authClient } from "#/features/auth/client";
import { CreateOrganizationForm } from "./create-form";

export function OrganizationDialog() {
	const { data: session } = authClient.useSession();
	const needsOrg = !!session?.user && !session.session?.activeOrganizationId;
	const [open, setOpen] = useState(needsOrg);

	useEffect(() => {
		setOpen(needsOrg);
	}, [needsOrg]);

	return (
		<Dialog
			isOpen={open}
			onOpenChange={setOpen}
			isDismissable={false}
			showCloseButton={false}
		>
			<DialogHeader>
				<DialogTitle>Create your organization</DialogTitle>
			</DialogHeader>
			<CreateOrganizationForm />
		</Dialog>
	);
}
