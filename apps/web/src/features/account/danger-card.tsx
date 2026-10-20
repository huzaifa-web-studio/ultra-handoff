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

import { Button } from "@org/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@org/ui/components/card";
import { Field, FieldDescription, FieldLabel } from "@org/ui/components/field";
import { Input } from "@org/ui/components/input";
import { Separator } from "@org/ui/components/separator";
import { Skeleton } from "@org/ui/components/skeleton";
import { useState } from "react";

import { useAccountDeletionCheck, useDeleteAccount } from "./hooks";

type DangerCardProps = {
	email: string;
};

export function DangerCard({ email }: DangerCardProps) {
	const deletionCheck = useAccountDeletionCheck();
	const deleteAccount = useDeleteAccount();
	const [confirmEmail, setConfirmEmail] = useState("");
	const [notice, setNotice] = useState<string | null>(null);

	// Case insensitive and trimmed so a phone keyboard adding a space does not
	// block the confirmation.
	const emailMatches =
		confirmEmail.trim().toLowerCase() === email.trim().toLowerCase();
	const allowed = deletionCheck.data?.allowed === true;
	const canDelete = emailMatches && allowed;

	async function handleDelete() {
		if (!canDelete) return;

		setNotice(null);

		try {
			await deleteAccount.mutateAsync();
		} catch {
			// The mutation error is rendered below.
			return;
		}

		setConfirmEmail("");
		setNotice(
			"Check your email to finish deleting your account. Nothing is deleted until you open the link in a signed-in browser.",
		);
	}

	return (
		<Card className="border border-danger">
			<CardHeader>
				<CardTitle className="text-danger">Delete account</CardTitle>
				<CardDescription>
					Permanently remove your account and everything connected to it. This
					action cannot be undone.
				</CardDescription>
			</CardHeader>

			<CardContent className="flex flex-col gap-5">
				<ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-app-text-muted">
					<li>Your profile, avatar and email will be deleted.</li>
					<li>Your Google and GitHub sign-in methods will be disconnected.</li>
					<li>You will be signed out on every device.</li>
					<li>
						Your organization memberships will be removed. If you are the last
						owner of an organization, deletion is blocked until you transfer
						ownership.
					</li>
					<li>
						We email you a confirmation link. The account is only deleted after
						you open it.
					</li>
				</ul>

				<Separator />

				{deletionCheck.isPending && <Skeleton className="h-24 w-full" />}

				{deletionCheck.isError && (
					<p role="alert" className="text-sm text-danger">
						{deletionCheck.error instanceof Error
							? deletionCheck.error.message
							: "Could not check whether your account can be deleted."}
					</p>
				)}

				{deletionCheck.data && !deletionCheck.data.allowed && (
					<div className="flex flex-col gap-3 border border-danger bg-danger-bg p-3">
						<p className="text-sm text-danger">{deletionCheck.data.reason}</p>
						<p className="text-xs text-danger">
							Open your organization settings, transfer ownership to another
							member, then recheck.
						</p>
						<div>
							<Button
								variant="outline"
								size="sm"
								loading={deletionCheck.isRefetching}
								onPress={() => deletionCheck.refetch()}
							>
								Recheck
							</Button>
						</div>
					</div>
				)}

				{allowed && (
					<form
						onSubmit={(event) => {
							event.preventDefault();
							event.stopPropagation();
							void handleDelete();
						}}
						className="flex flex-col gap-4"
					>
						<Field>
							<FieldLabel htmlFor="delete-confirm-email">
								Type your email to confirm
							</FieldLabel>
							<Input
								id="delete-confirm-email"
								type="email"
								autoComplete="off"
								spellCheck={false}
								value={confirmEmail}
								onChange={(event) => setConfirmEmail(event.target.value)}
								placeholder={email}
							/>
							<FieldDescription>
								Type <span className="font-medium text-app-text">{email}</span>{" "}
								exactly to enable deletion.
							</FieldDescription>
						</Field>

						{deleteAccount.error && (
							<p role="alert" className="text-sm text-danger">
								{deleteAccount.error instanceof Error
									? deleteAccount.error.message
									: "Could not delete your account."}
							</p>
						)}

						{notice && (
							<output className="block text-sm text-success">{notice}</output>
						)}

						<Button
							type="submit"
							variant="destructive"
							loading={deleteAccount.isPending}
							isDisabled={!canDelete || deleteAccount.isPending}
						>
							Delete account
						</Button>

						<p className="text-xs font-semibold tracking-wide text-danger uppercase">
							This action is permanent and cannot be undone.
						</p>
					</form>
				)}
			</CardContent>
		</Card>
	);
}
