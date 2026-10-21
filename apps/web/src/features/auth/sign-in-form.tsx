import { Button } from "@org/ui/components/button";
import { Field, FieldError, FieldLabel } from "@org/ui/components/field";
import { Input } from "@org/ui/components/input";
import { PasswordInput } from "@org/ui/components/password-input";
import { GithubLight as GithubIcon } from "@org/ui/components/ui/svgs/githubLight";
import { Google } from "@org/ui/components/ui/svgs/google";
import { useForm } from "@tanstack/react-form";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toFieldErrors } from "#/lib/form-errors";
import { authClient } from "./client";
import { signInSchema } from "./schema";
import { closeAuthDialog, openForgotPassword } from "./store";
import { broadcastAuth } from "./sync";

export function AuthSignInForm() {
	const navigate = useNavigate();
	const location = useLocation();
	const isInvitePage = location.pathname.startsWith("/invite/");
	const [error, setError] = useState<string | null>(null);

	const form = useForm({
		defaultValues: { email: "", password: "" },
		// Validate the whole object on submit only. Live feedback comes from
		// each field's own onChange validator, so typing in one input never
		// marks the untouched ones as invalid.
		validators: { onSubmit: signInSchema },
		onSubmit: async ({ value }) => {
			setError(null);
			try {
				const { error } = await authClient.signIn.email({
					email: value.email,
					password: value.password,
				});
				if (error) {
					setError(error.message ?? "Sign in failed");
					return;
				}
				closeAuthDialog();
				broadcastAuth("auth:signed-in");

				// On the invite page, stay put. The session update refetches the
				// invitation preview and turns the card into the accept state.
				// Everywhere else keep the existing home redirect.
				if (!isInvitePage) {
					navigate({ to: "/" });
				}
			} catch (err) {
				setError(err instanceof Error ? err.message : "Sign in failed");
			}
		},
	});

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
				name="email"
				validators={{ onChange: signInSchema.shape.email }}
			>
				{(field) => (
					<Field>
						<FieldLabel>Email</FieldLabel>
						<Input
							type="email"
							autoFocus
							tabIndex={0}
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
				validators={{ onChange: signInSchema.shape.password }}
			>
				{(field) => (
					<Field>
						<FieldLabel>Password</FieldLabel>
						<PasswordInput
							value={field.state.value}
							onBlur={field.handleBlur}
							onChange={(e) => field.handleChange(e.target.value)}
						/>
						<FieldError errors={toFieldErrors(field.state.meta.errors)} />
					</Field>
				)}
			</form.Field>
			<div className="flex justify-end">
				<Button
					type="button"
					variant="link"
					className="h-auto px-0 py-0 active:!transform-none"
					onPress={() => openForgotPassword(form.state.values.email)}
				>
					Forgot password?
				</Button>
			</div>
			{error && (
				<p role="alert" className="text-sm text-danger">
					{error}
				</p>
			)}
			<form.Subscribe selector={(s) => s.isSubmitting}>
				{(isSubmitting) => (
					<Button type="submit" loading={isSubmitting}>
						{isSubmitting ? "Signing in..." : "Sign in"}
					</Button>
				)}
			</form.Subscribe>
			<div className="flex flex-col gap-2">
				<Button
					type="button"
					variant="outline"
					onPress={async () => {
						setError(null);
						// Return to the page the user signed in from. On an
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
