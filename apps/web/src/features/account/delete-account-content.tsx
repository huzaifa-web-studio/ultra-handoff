/**
 * Body of the delete-account flow, without any card or dialog chrome.
 *
 * Why separate: the same content is reused by `DangerCard` (account settings
 * page, wrapped in a Card) and by the delete-account dialog on the
 * no-organization landing page (wrapped in a Dialog). Keeping the heading and
 * container out of here avoids duplicate titles and lets each wrapper apply
 * its own danger border.
 *
 * Used by: src/features/account/danger-card.tsx, src/routes/index.tsx.
 */
import { Button } from "@org/ui/components/button";
import { Field, FieldDescription, FieldLabel } from "@org/ui/components/field";
import { Input } from "@org/ui/components/input";
import { Separator } from "@org/ui/components/separator";
import { Skeleton } from "@org/ui/components/skeleton";
import { useState } from "react";
import { broadcastAuth } from "#/features/auth/sync";
import { useAccountDeletionCheck, useDeleteAccount } from "./hooks";

type DeleteAccountContentProps = {
	email: string;
};

export function DeleteAccountContent({ email }: DeleteAccountContentProps) {
	const deletionCheck = useAccountDeletionCheck();
	const deleteAccount = useDeleteAccount();
	const [confirmEmail, setConfirmEmail] = useState("");
	const [notice, setNotice] = useState<string | null>(null);

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
			return;
		}

		broadcastAuth("auth:account-deleted");
		setConfirmEmail("");
		setNotice(
			"We are sending a confirmation email. Open the link in a signed-in browser to finish deleting your account. It can take a minute to arrive.",
		);
	}

	return (
		<div className="flex flex-col gap-5">
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
		</div>
	);
}
