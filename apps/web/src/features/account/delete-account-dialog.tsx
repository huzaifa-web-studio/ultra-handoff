/**
 * Self-contained delete-account dialog.
 *
 * Why self-contained: the trigger button and the dialog live in the same
 * component, so callers (for example the no-organization header) only render
 * `<DeleteAccountDialog />` instead of juggling open state and a separate
 * dialog. The email is read from the session here so the caller passes nothing.
 *
 * Used by: src/components/home-header.tsx.
 */
import { Button } from "@org/ui/components/button";
import {
	Dialog,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@org/ui/components/dialog";
import { Trash2Icon } from "lucide-react";

import { authClient } from "#/features/auth/client";
import { DeleteAccountContent } from "./delete-account-content";

export function DeleteAccountDialog() {
	const { data: session } = authClient.useSession();

	if (!session?.user) return null;

	return (
		<DialogTrigger>
			<Button
				variant="outline"
				size="sm"
				className="text-danger"
				aria-label="Delete account"
			>
				<Trash2Icon />
				<span className="hidden sm:inline">Delete account</span>
			</Button>
			<Dialog isDismissable className="border border-danger">
				<DialogHeader>
					<DialogTitle className="text-danger">Delete account</DialogTitle>
				</DialogHeader>
				<DeleteAccountContent email={session.user.email} />
			</Dialog>
		</DialogTrigger>
	);
}
