/**
 * Forgot password form shown in the auth dialog.
 *
 * Why: a signed-out user needs a way to request a reset link without retyping
 * the email they already entered on the sign-in form. The dialog store carries
 * that address in as `defaultEmail`.
 *
 * Used by: src/features/auth/auth-dialog.tsx and the reset link error state.
 */

import { Button } from "@org/ui/components/button";
import { Field, FieldError, FieldLabel } from "@org/ui/components/field";
import { Input } from "@org/ui/components/input";
import { useForm } from "@tanstack/react-form";
import { useState } from "react";

import { useAutoDismiss } from "#/hooks/use-auto-dismiss";
import { useCooldown } from "#/hooks/use-cooldown";
import { toFieldErrors } from "#/lib/form-errors";
import { authClient } from "./client";
import { forgotPasswordSchema } from "./schema";
import { closeAuthDialog, openSignIn } from "./store";

type ForgotPasswordFormProps = {
	/** Email carried over from the sign-in form, if the user typed one. */
	defaultEmail?: string;
};

export function AuthForgotPasswordForm({
	defaultEmail = "",
}: ForgotPasswordFormProps) {
	const [sentEmail, setSentEmail] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [resending, setResending] = useState(false);
	const [resendNotice, setResendNotice] = useState<string | null>(null);
	const cooldown = useCooldown();

	// The resend confirmation is transient. Errors stay until the user acts.
	useAutoDismiss(resendNotice, () => setResendNotice(null));

	/** Request the same reset link again, after the cooldown. */
	async function handleResend() {
		if (!sentEmail || resending || cooldown.isActive) return;

		setResending(true);
		setError(null);
		setResendNotice(null);

		try {
			const { error: resendError } = await authClient.requestPasswordReset({
				email: sentEmail,
				redirectTo: `${window.location.origin}/reset-password`,
			});

			if (resendError) {
				setError(resendError.message ?? "Could not resend the reset email.");
				return;
			}

			setResendNotice("Reset email sent again.");
			// Start the wait again so one click cannot queue several messages.
			cooldown.start();
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: "Could not resend the reset email.",
			);
		} finally {
			setResending(false);
		}
	}

	const form = useForm({
		defaultValues: { email: defaultEmail },
		validators: { onChange: forgotPasswordSchema },
		onSubmit: async ({ value }) => {
			setError(null);

			try {
				const { error: requestError } = await authClient.requestPasswordReset({
					email: value.email,
					// Where the API redirects after validating the emailed
					// token. It adds `?token=` or `?error=INVALID_TOKEN`.
					redirectTo: `${window.location.origin}/reset-password`,
				});

				if (requestError) {
					setError(requestError.message ?? "Could not send the reset email.");
					return;
				}

				setSentEmail(value.email);
				// The first message was just queued, so start the wait now.
				cooldown.start();
			} catch (err) {
				setError(
					err instanceof Error
						? err.message
						: "Could not send the reset email.",
				);
			}
		},
	});

	if (sentEmail) {
		return (
			<div className="flex flex-col gap-4 text-center">
				<p className="text-app-text">
					If an account exists for{" "}
					<span className="font-semibold">{sentEmail}</span>, a reset link is on
					its way.
				</p>
				<p className="text-sm text-app-text-muted">
					It expires in one hour. Check your spam folder if it does not arrive.
				</p>
				{resendNotice && (
					<output className="text-sm text-success">{resendNotice}</output>
				)}
				{error && (
					<p role="alert" className="text-sm text-danger">
						{error}
					</p>
				)}
				<Button
					variant="outline"
					loading={resending}
					isDisabled={resending || cooldown.isActive}
					onPress={handleResend}
				>
					{cooldown.isActive
						? `Resend in ${cooldown.remaining}s`
						: "Resend email"}
				</Button>
				<Button
					variant="outline"
					onPress={() => {
						closeAuthDialog();
						openSignIn();
					}}
				>
					Back to sign in
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
			<p className="text-sm text-app-text-muted">
				Enter the email you use to sign in and we will send you a link to set a
				new password.
			</p>

			<form.Field name="email">
				{(field) => (
					<Field>
						<FieldLabel htmlFor="forgot-email">Email</FieldLabel>
						<Input
							id="forgot-email"
							type="email"
							// Only steal focus when the field still needs typing.
							autoFocus={!defaultEmail}
							autoComplete="email"
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

			<form.Subscribe selector={(state) => state.isSubmitting}>
				{(isSubmitting) => (
					<Button type="submit" loading={isSubmitting}>
						{isSubmitting ? "Sending..." : "Send reset link"}
					</Button>
				)}
			</form.Subscribe>
		</form>
	);
}
