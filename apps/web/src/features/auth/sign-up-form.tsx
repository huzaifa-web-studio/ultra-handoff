import { Button } from "@org/ui/components/button";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
} from "@org/ui/components/field";
import { Input } from "@org/ui/components/input";
import { PasswordInput } from "@org/ui/components/password-input";
import { GithubLight as GithubIcon } from "@org/ui/components/ui/svgs/githubLight";
import { Google } from "@org/ui/components/ui/svgs/google";
import { useForm } from "@tanstack/react-form";
import { useLocation } from "@tanstack/react-router";
import { useState } from "react";
import { FieldMeta } from "#/components/field-meta";
import { toFieldErrors } from "#/lib/form-errors";
import { EMAIL_MAX, USER_NAME_MAX } from "#/lib/limits";
import { PASSWORD_MAX, passwordRuleMessage } from "#/lib/password";
import { authClient } from "./client";
import { signUpSchema } from "./schema";
import { VerifyEmailCard } from "./verify-email-card";

export function AuthSignUpForm() {
	const location = useLocation();
	// On the invite page the card needs the session to move to the accept
	// state, so the form must not navigate away.
	const isInvitePage = location.pathname.startsWith("/invite/");
	const [error, setError] = useState<string | null>(null);
	// Address the confirmation mail went to. Set only after a successful sign
	// up, and the whole form is replaced by the pending state while it is here.
	const [pendingEmail, setPendingEmail] = useState<string | null>(null);

	const form = useForm({
		defaultValues: { name: "", email: "", password: "" },
		// Validate the whole object on submit only. Live feedback comes from
		// each field's own onChange validator, so typing in one input never
		// marks the untouched ones as invalid.
		validators: { onSubmit: signUpSchema },
		onSubmit: async ({ value }) => {
			setError(null);
			try {
				const { error } = await authClient.signUp.email({
					name: value.name,
					email: value.email,
					password: value.password,
				});
				if (error) {
					setError(error.message ?? "Sign up failed");
					return;
				}

				// Sign up deliberately returns no session. The account becomes
				// usable when the emailed link is opened, which also signs the
				// person in. Keeping the dialog on the pending state puts the
				// resend action exactly where they are looking.
				setPendingEmail(value.email.trim());
			} catch (err) {
				setError(err instanceof Error ? err.message : "Sign up failed");
			}
		},
	});

	/** Go back to an empty form when the address was wrong. */
	function handleUseDifferentEmail() {
		setPendingEmail(null);
		setError(null);
		form.reset();
	}

	if (pendingEmail) {
		return (
			<div className="flex flex-col gap-4">
				<VerifyEmailCard
					state="pending"
					email={pendingEmail}
					hint={
						isInvitePage
							? "Open the link, then come back to this page to accept the invitation."
							: undefined
					}
				/>
				<Button
					type="button"
					variant="outline"
					onPress={handleUseDifferentEmail}
				>
					Use a different email
				</Button>
			</div>
		);
	}

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				e.stopPropagation();
				form.handleSubmit();
			}}
			className="flex flex-col gap-4"
		>
			<form.Field
				name="name"
				validators={{ onChange: signUpSchema.shape.name }}
			>
				{(field) => (
					<Field>
						<FieldLabel>Name</FieldLabel>
						<Input
							type="text"
							autoFocus
							tabIndex={0}
							autoComplete="name"
							maxLength={USER_NAME_MAX}
							value={field.state.value}
							onBlur={field.handleBlur}
							onChange={(e) => field.handleChange(e.target.value)}
						/>
						<FieldError errors={toFieldErrors(field.state.meta.errors)} />
						<FieldMeta
							counter={{
								current: field.state.value.length,
								max: USER_NAME_MAX,
							}}
						>
							The name your team and clients will see.
						</FieldMeta>
					</Field>
				)}
			</form.Field>
			<form.Field
				name="email"
				validators={{ onChange: signUpSchema.shape.email }}
			>
				{(field) => (
					<Field>
						<FieldLabel>Email</FieldLabel>
						<Input
							type="email"
							autoComplete="email"
							maxLength={EMAIL_MAX}
							value={field.state.value}
							onBlur={field.handleBlur}
							onChange={(e) => field.handleChange(e.target.value)}
						/>
						<FieldError errors={toFieldErrors(field.state.meta.errors)} />
					</Field>
				)}
			</form.Field>
			<form.Field
				name="password"
				validators={{ onChange: signUpSchema.shape.password }}
			>
				{(field) => (
					<Field>
						<FieldLabel>Password</FieldLabel>
						<PasswordInput
							autoComplete="new-password"
							maxLength={PASSWORD_MAX}
							value={field.state.value}
							onBlur={field.handleBlur}
							onChange={(e) => field.handleChange(e.target.value)}
						/>
						<FieldError errors={toFieldErrors(field.state.meta.errors)} />
						<FieldDescription>{passwordRuleMessage}.</FieldDescription>
					</Field>
				)}
			</form.Field>
			{error && (
				<p role="alert" className="text-sm text-danger">
					{error}
				</p>
			)}
			<form.Subscribe selector={(s) => s.isSubmitting}>
				{(isSubmitting) => (
					<Button type="submit" loading={isSubmitting}>
						{isSubmitting ? "Creating account..." : "Sign up"}
					</Button>
				)}
			</form.Subscribe>
			<div className="flex flex-col gap-2">
				<Button
					type="button"
					variant="outline"
					onPress={async () => {
						setError(null);
						// Return to the page the user signed up from. On an
						// invitation that is the accept page, so the session
						// match can complete the invite instead of dropping them
						// on the home screen.
						const { error: socialError } = await authClient.signIn.social({
							provider: "github",
							callbackURL: window.location.href,
						});

						if (socialError) {
							setError(
								socialError.message ?? "Could not continue with GitHub.",
							);
						}
					}}
				>
					<GithubIcon className="h-4 w-4" /> Continue with GitHub
				</Button>
				<Button
					type="button"
					variant="outline"
					onPress={async () => {
						setError(null);
						const { error: socialError } = await authClient.signIn.social({
							provider: "google",
							callbackURL: window.location.href,
						});

						if (socialError) {
							setError(
								socialError.message ?? "Could not continue with Google.",
							);
						}
					}}
				>
					<Google className="h-4 w-4" /> Continue with Google
				</Button>
			</div>
		</form>
	);
}
