/**
 * Set a new password from an emailed reset link.
 *
 * Why: the reset token arrives on the page as a query parameter. This form is
 * the only place that exchanges it for a new password, so the success and
 * expired states stay together.
 *
 * Used by: src/routes/reset-password.tsx.
 */

import { Button } from "@org/ui/components/button";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
} from "@org/ui/components/field";
import { PasswordInput } from "@org/ui/components/password-input";
import { useForm } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { toFieldErrors } from "#/lib/form-errors";
import { passwordRuleMessage } from "#/lib/password";
import { authClient } from "./client";
import { resetPasswordSchema } from "./schema";
import { openSignIn } from "./store";

type ResetPasswordFormProps = {
	token: string;
	/** Open the forgot password form when the token cannot be used. */
	onRequestNewLink: () => void;
};

export function ResetPasswordForm({
	token,
	onRequestNewLink,
}: ResetPasswordFormProps) {
	const navigate = useNavigate();
	const [error, setError] = useState<string | null>(null);
	const [needsNewLink, setNeedsNewLink] = useState(false);
	const [done, setDone] = useState(false);

	const form = useForm({
		defaultValues: { newPassword: "", confirmPassword: "" },
		// Validate the whole object on submit only. Live feedback comes from
		// each field's own onChange validator, so typing in one input never
		// marks the untouched ones as invalid.
		validators: { onSubmit: resetPasswordSchema },
		onSubmit: async ({ value }) => {
			setError(null);
			setNeedsNewLink(false);

			// Confirm is a form concern, not an API field.
			if (value.newPassword !== value.confirmPassword) {
				setError("The passwords do not match.");
				return;
			}

			try {
				const { error: resetError } = await authClient.resetPassword({
					newPassword: value.newPassword,
					token,
				});

				if (resetError) {
					setError(resetError.message ?? "Could not reset your password.");
					// A rejected or expired token needs a fresh email.
					setNeedsNewLink(true);
					return;
				}

				setDone(true);
			} catch (submitError) {
				setError(
					submitError instanceof Error
						? submitError.message
						: "Could not reset your password.",
				);
			}
		},
	});

	if (done) {
		return (
			<div className="flex flex-col gap-4">
				<output className="block text-sm text-success">
					Password updated. Sign in with your new password.
				</output>
				<p className="text-sm text-app-text-muted">
					Every session was signed out after the reset.
				</p>
				<Button
					onPress={() => {
						navigate({ to: "/" });
						openSignIn();
					}}
				>
					Sign in
				</Button>
			</div>
		);
	}

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				form.handleSubmit();
			}}
			className="flex flex-col gap-4"
		>
			<form.Field
				name="newPassword"
				validators={{ onChange: resetPasswordSchema.shape.newPassword }}
			>
				{(field) => (
					<Field>
						<FieldLabel htmlFor="reset-new-password">New password</FieldLabel>
						<PasswordInput
							id="reset-new-password"
							autoComplete="new-password"
							value={field.state.value}
							onBlur={field.handleBlur}
							onChange={(event) => field.handleChange(event.target.value)}
						/>
						<FieldError errors={toFieldErrors(field.state.meta.errors)} />
						<FieldDescription>{passwordRuleMessage}.</FieldDescription>
					</Field>
				)}
			</form.Field>

			<form.Field
				name="confirmPassword"
				validators={{
					onChange: resetPasswordSchema.shape.confirmPassword,
				}}
			>
				{(field) => (
					<Field>
						<FieldLabel htmlFor="reset-confirm-password">
							Confirm new password
						</FieldLabel>
						<PasswordInput
							id="reset-confirm-password"
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

			{needsNewLink && (
				<Button type="button" variant="outline" onPress={onRequestNewLink}>
					Request a new link
				</Button>
			)}

			<form.Subscribe selector={(state) => state.isSubmitting}>
				{(isSubmitting) => (
					<Button type="submit" loading={isSubmitting}>
						{isSubmitting ? "Updating..." : "Set new password"}
					</Button>
				)}
			</form.Subscribe>
		</form>
	);
}
