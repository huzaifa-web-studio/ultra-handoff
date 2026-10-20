import { Button } from "@org/ui/components/button";
import { Field, FieldError, FieldLabel } from "@org/ui/components/field";
import { Input } from "@org/ui/components/input";
import { PasswordInput } from "@org/ui/components/password-input";
import { GithubLight as GithubIcon } from "@org/ui/components/ui/svgs/githubLight";
import { Google } from "@org/ui/components/ui/svgs/google";
import { useForm } from "@tanstack/react-form";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { useAutoDismiss } from "#/hooks/use-auto-dismiss";
import { toFieldErrors } from "#/lib/form-errors";
import { authClient } from "./client";
import { signUpSchema } from "./schema";
import { closeAuthDialog, openSignIn } from "./store";

/** Seconds a user must wait between verification emails. */
const RESEND_COOLDOWN_SECONDS = 60;

export function AuthSignUpForm() {
	const [sentEmail, setSentEmail] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [resending, setResending] = useState(false);
	const [resendNotice, setResendNotice] = useState<string | null>(null);
	const [cooldown, setCooldown] = useState(0);

	// The resend confirmation is transient. Errors stay until the user acts.
	useAutoDismiss(resendNotice, () => setResendNotice(null));

	/**
	 * Count the cooldown down one second at a time.
	 *
	 * A timeout that re-arms itself is enough here. The screen always shows a
	 * whole number of seconds, so drift within a tick does not matter.
	 */
	useEffect(() => {
		if (cooldown <= 0) return;

		const timer = window.setTimeout(() => {
			setCooldown((remaining) => Math.max(0, remaining - 1));
		}, 1000);

		return () => window.clearTimeout(timer);
	}, [cooldown]);

	/**
	 * Ask the API to queue another verification email.
	 *
	 * Why a separate action: delivery is asynchronous now, so a message can be
	 * delayed or land in spam. The user should not have to sign up again.
	 */
	async function handleResend() {
		if (!sentEmail || resending || cooldown > 0) return;

		setResending(true);
		setError(null);
		setResendNotice(null);

		try {
			const { error: resendError } = await authClient.sendVerificationEmail({
				email: sentEmail,
			});

			if (resendError) {
				setError(
					resendError.message ?? "Could not resend the verification email.",
				);
				return;
			}

			setResendNotice("Verification email sent again.");
			// Start the wait again so a queued message cannot be spammed.
			setCooldown(RESEND_COOLDOWN_SECONDS);
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: "Could not resend the verification email.",
			);
		} finally {
			setResending(false);
		}
	}

	const form = useForm({
		defaultValues: { name: "", email: "", password: "" },
		validators: { onChange: signUpSchema },
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
				setSentEmail(value.email);
				// The first message was just queued, so start the wait now.
				setCooldown(RESEND_COOLDOWN_SECONDS);
			} catch (err) {
				setError(err instanceof Error ? err.message : "Sign up failed");
			}
		},
	});

	if (sentEmail) {
		return (
			<div className="flex flex-col gap-4 text-center">
				<p className="text-app-text">
					If <span className="font-semibold">{sentEmail}</span> still needs
					verification, a link is on its way.
				</p>
				<p className="text-sm text-app-text-muted">
					It usually arrives within a minute. The link expires in one hour.
				</p>
				<p className="text-sm text-app-text-muted">
					Already have an account?{" "}
					<Button
						variant="link"
						className="h-auto px-0 py-0 active:!transform-none"
						onPress={() => {
							closeAuthDialog();
							openSignIn();
						}}
					>
						Sign in instead
					</Button>
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
					isDisabled={resending || cooldown > 0}
					onPress={handleResend}
				>
					{cooldown > 0 ? `Resend in ${cooldown}s` : "Resend email"}
				</Button>
				<Button
					variant="outline"
					onPress={() => {
						setSentEmail(null);
						setResendNotice(null);
						setError(null);
						setCooldown(0);
						form.setFieldValue("password", "");
					}}
				>
					<ArrowLeft className="h-4 w-4" /> Back
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
				validators={{
					onChange: ({ value }) =>
						value.trim() ? undefined : "Name is required",
				}}
			>
				{(field) => (
					<Field>
						<FieldLabel>Name</FieldLabel>
						<Input
							type="text"
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
			<form.Field name="email">
				{(field) => (
					<Field>
						<FieldLabel>Email</FieldLabel>
						<Input
							type="email"
							value={field.state.value}
							onBlur={field.handleBlur}
							onChange={(e) => field.handleChange(e.target.value)}
						/>
						<FieldError errors={toFieldErrors(field.state.meta.errors)} />
					</Field>
				)}
			</form.Field>
			<form.Field name="password">
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
					onPress={() => {
						closeAuthDialog();
						authClient.signIn.social({
							provider: "github",
							callbackURL: `${window.location.origin}/`,
						});
					}}
				>
					<GithubIcon className="h-4 w-4" /> Continue with GitHub
				</Button>
				<Button
					type="button"
					variant="outline"
					onPress={() => {
						closeAuthDialog();
						authClient.signIn.social({
							provider: "google",
							callbackURL: `${window.location.origin}/`,
						});
					}}
				>
					<Google className="h-4 w-4" /> Continue with Google
				</Button>
			</div>
		</form>
	);
}
