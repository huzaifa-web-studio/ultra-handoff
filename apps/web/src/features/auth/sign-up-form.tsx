import { Button } from "@org/ui/components/button";
import { Field, FieldError, FieldLabel } from "@org/ui/components/field";
import { Input } from "@org/ui/components/input";
import { PasswordInput } from "@org/ui/components/password-input";
import { GithubLight as GithubIcon } from "@org/ui/components/ui/svgs/githubLight";
import { Google } from "@org/ui/components/ui/svgs/google";
import { useForm } from "@tanstack/react-form";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { authClient } from "./client";
import { signUpSchema } from "./schema";
import { closeAuthDialog } from "./store";

export function AuthSignUpForm() {
	const [sentEmail, setSentEmail] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

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
			} catch (err) {
				setError(err instanceof Error ? err.message : "Sign up failed");
			}
		},
	});

	if (sentEmail) {
		return (
			<div className="flex flex-col gap-4 text-center">
				<p className="text-app-text">
					We have sent a verification email to{" "}
					<span className="font-semibold">{sentEmail}</span>.
				</p>
				<p className="text-sm text-app-text-muted">
					Please check your inbox and click the link to verify your account.
				</p>
				<Button
					variant="outline"
					onPress={() => {
						setSentEmail(null);
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
						<FieldError
							errors={field.state.meta.errors.map((e) => ({
								message: String(e),
							}))}
						/>
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
						<FieldError
							errors={field.state.meta.errors.map((e) => ({
								message: String(e),
							}))}
						/>
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
						<FieldError
							errors={field.state.meta.errors.map((e) => ({
								message: String(e),
							}))}
						/>
					</Field>
				)}
			</form.Field>
			{error && <p className="text-sm text-danger">{error}</p>}
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
