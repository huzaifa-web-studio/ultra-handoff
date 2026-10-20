/**
 * Password section of the account settings page.
 *
 * Two cases:
 *   1. The account already has a credential row, so the user changes the
 *      password with the current one as proof.
 *   2. The account is social only, so the user sets a first password through
 *      the server-only endpoint. The API refuses if a credential already
 *      exists, which keeps the current-password guarantee intact.
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
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
} from "@org/ui/components/field";
import { PasswordInput } from "@org/ui/components/password-input";
import { Skeleton } from "@org/ui/components/skeleton";
import { useForm } from "@tanstack/react-form";
import { useState } from "react";

import { authClient } from "#/features/auth/client";
import { useAutoDismiss } from "#/hooks/use-auto-dismiss";
import { toFieldErrors } from "#/lib/form-errors";
import { setAccountPassword } from "./api";
import { changePasswordSchema, setPasswordSchema } from "./schema";

type PasswordCardProps = {
	hasPassword: boolean;
	/** True while the linked account list is still loading. */
	isLoading?: boolean;
	/** Refetch linked accounts so the credential row appears immediately. */
	onChanged: () => void | Promise<void>;
};

export function PasswordCard({
	hasPassword,
	isLoading = false,
	onChanged,
}: PasswordCardProps) {
	// A first password changes which form is shown, so the confirmation has to
	// live above both forms. Otherwise it unmounts with the set form.
	const [notice, setNotice] = useState<string | null>(null);

	useAutoDismiss(notice, () => setNotice(null));

	return (
		<Card>
			<CardHeader>
				<CardTitle>Password</CardTitle>
				<CardDescription>
					{isLoading
						? "Change or set the password used to sign in."
						: hasPassword
							? "Change the password you use to sign in with email."
							: "You signed in with a social provider. Set a password to also sign in with email."}
				</CardDescription>
			</CardHeader>

			<CardContent className="flex flex-col gap-4">
				{notice && (
					<output className="block text-sm text-success">{notice}</output>
				)}

				{isLoading ? (
					// Avoid flashing the "set password" form before we know
					// whether a credential account exists.
					<Skeleton className="h-40 w-full" />
				) : hasPassword ? (
					<ChangePasswordForm />
				) : (
					<SetPasswordForm
						onSet={async () => {
							await onChanged();
							setNotice("Password set. You can now sign in with email.");
						}}
					/>
				)}
			</CardContent>
		</Card>
	);
}

function ChangePasswordForm() {
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState<string | null>(null);

	useAutoDismiss(saved, () => setSaved(null));

	const form = useForm({
		defaultValues: {
			currentPassword: "",
			newPassword: "",
			confirmPassword: "",
		},
		validators: { onChange: changePasswordSchema },
		onSubmit: async ({ value }) => {
			setError(null);
			setSaved(null);

			// Confirm is a form concern, not an API field, so it is checked
			// here instead of being sent to Better Auth.
			if (value.newPassword !== value.confirmPassword) {
				setError("The new passwords do not match.");
				return;
			}

			try {
				const { error: changeError } = await authClient.changePassword({
					currentPassword: value.currentPassword,
					newPassword: value.newPassword,
					// Keep the current tab signed in, sign out every other one.
					revokeOtherSessions: true,
				});

				if (changeError) {
					setError(changeError.message ?? "Could not change your password.");
					return;
				}

				form.reset();
				setSaved("Password updated. Other sessions were signed out.");
			} catch (submitError) {
				setError(
					submitError instanceof Error
						? submitError.message
						: "Could not change your password.",
				);
			}
		},
	});

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				form.handleSubmit();
			}}
			className="flex flex-col gap-4"
		>
			<form.Field name="currentPassword">
				{(field) => (
					<Field>
						<FieldLabel htmlFor="current-password">Current password</FieldLabel>
						<PasswordInput
							id="current-password"
							autoComplete="current-password"
							value={field.state.value}
							onBlur={field.handleBlur}
							onChange={(event) => field.handleChange(event.target.value)}
						/>
						<FieldError errors={toFieldErrors(field.state.meta.errors)} />
					</Field>
				)}
			</form.Field>

			<form.Field name="newPassword">
				{(field) => (
					<Field>
						<FieldLabel htmlFor="new-password">New password</FieldLabel>
						<PasswordInput
							id="new-password"
							autoComplete="new-password"
							value={field.state.value}
							onBlur={field.handleBlur}
							onChange={(event) => field.handleChange(event.target.value)}
						/>
						<FieldError errors={toFieldErrors(field.state.meta.errors)} />
						<FieldDescription>
							8+ characters with upper, lower, number and special character.
						</FieldDescription>
					</Field>
				)}
			</form.Field>

			<form.Field name="confirmPassword">
				{(field) => (
					<Field>
						<FieldLabel htmlFor="confirm-password">
							Confirm new password
						</FieldLabel>
						<PasswordInput
							id="confirm-password"
							autoComplete="new-password"
							value={field.state.value}
							onBlur={field.handleBlur}
							onChange={(event) => field.handleChange(event.target.value)}
						/>
						<FieldError errors={toFieldErrors(field.state.meta.errors)} />
					</Field>
				)}
			</form.Field>

			{error && (
				<p role="alert" className="text-sm text-danger">
					{error}
				</p>
			)}

			{saved && !error && (
				<output className="block text-sm text-success">{saved}</output>
			)}

			<div>
				<form.Subscribe selector={(state) => state.isSubmitting}>
					{(isSubmitting) => (
						<Button type="submit" loading={isSubmitting}>
							{isSubmitting ? "Updating..." : "Update password"}
						</Button>
					)}
				</form.Subscribe>
			</div>
		</form>
	);
}

function SetPasswordForm({
	onSet,
}: {
	/** Persist the first password and let the parent confirm it. */
	onSet: () => void | Promise<void>;
}) {
	const [error, setError] = useState<string | null>(null);

	const form = useForm({
		defaultValues: { newPassword: "", confirmPassword: "" },
		validators: { onChange: setPasswordSchema },
		onSubmit: async ({ value }) => {
			setError(null);

			if (value.newPassword !== value.confirmPassword) {
				setError("The passwords do not match.");
				return;
			}

			try {
				await setAccountPassword(value.newPassword);
				form.reset();
				await onSet();
			} catch (submitError) {
				setError(
					submitError instanceof Error
						? submitError.message
						: "Could not set your password.",
				);
			}
		},
	});

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				form.handleSubmit();
			}}
			className="flex flex-col gap-4"
		>
			<form.Field name="newPassword">
				{(field) => (
					<Field>
						<FieldLabel htmlFor="set-new-password">New password</FieldLabel>
						<PasswordInput
							id="set-new-password"
							autoComplete="new-password"
							value={field.state.value}
							onBlur={field.handleBlur}
							onChange={(event) => field.handleChange(event.target.value)}
						/>
						<FieldError errors={toFieldErrors(field.state.meta.errors)} />
						<FieldDescription>
							8+ characters with upper, lower, number and special character.
						</FieldDescription>
					</Field>
				)}
			</form.Field>

			<form.Field name="confirmPassword">
				{(field) => (
					<Field>
						<FieldLabel htmlFor="set-confirm-password">
							Confirm password
						</FieldLabel>
						<PasswordInput
							id="set-confirm-password"
							autoComplete="new-password"
							value={field.state.value}
							onBlur={field.handleBlur}
							onChange={(event) => field.handleChange(event.target.value)}
						/>
						<FieldError errors={toFieldErrors(field.state.meta.errors)} />
					</Field>
				)}
			</form.Field>

			{error && (
				<p role="alert" className="text-sm text-danger">
					{error}
				</p>
			)}

			<div>
				<form.Subscribe selector={(state) => state.isSubmitting}>
					{(isSubmitting) => (
						<Button type="submit" loading={isSubmitting}>
							{isSubmitting ? "Setting..." : "Set password"}
						</Button>
					)}
				</form.Subscribe>
			</div>
		</form>
	);
}
