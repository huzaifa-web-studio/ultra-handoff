/**
 * Danger zone on the account settings page.
 *
 * Why the preflight: Better Auth sends the deletion email before its
 * `beforeDelete` hook runs. The card asks the API first so a blocked user sees
 * the organization ownership reason immediately and never receives an email
 * that could only fail.
 *
 * Used by: src/routes/_app/account.tsx.
 */
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@org/ui/components/card";

import { DeleteAccountContent } from "./delete-account-content";

type DangerCardProps = {
	email: string;
};

export function DangerCard({ email }: DangerCardProps) {
	return (
		<Card className="border border-danger">
			<CardHeader>
				<CardTitle className="text-danger">Delete account</CardTitle>
				<CardDescription>
					Permanently remove your account and everything connected to it. This
					action cannot be undone.
				</CardDescription>
			</CardHeader>

			<CardContent>
				<DeleteAccountContent email={email} />
			</CardContent>
		</Card>
	);
}
