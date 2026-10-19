import { Button } from "@org/ui/components/button";
import { Field, FieldError, FieldLabel } from "@org/ui/components/field";
import { Input } from "@org/ui/components/input";
import { PasswordInput } from "@org/ui/components/password-input";
import { GithubLight as GithubIcon } from "@org/ui/components/ui/svgs/githubLight";
import { Google } from "@org/ui/components/ui/svgs/google";
import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import { authClient } from "./client";
import { closeAuthDialog } from "./store";

export function AuthSignInForm() {
	const [error, setError] = useState<string | null>(null);

	const form = useForm({
		defaultValues: { email: "", password: "" },
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
				validators={{
					onChange: ({ value }) =>
						!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
							? "Invalid email"
							: undefined,
				}}
			>
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
			<form.Field
				name="password"
				validators={{
					onChange: ({ value }) =>
						/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/.test(value)
							? undefined
							: "Password must be 8+ chars with upper, lower, number, and special char",
				}}
			>
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
						{isSubmitting ? "Signing in..." : "Sign in"}
					</Button>
				)}
			</form.Subscribe>
			<div className="flex flex-col gap-2">
				<Button
					type="button"
					variant="outline"
					onPress={() =>
						authClient.signIn.social({
							provider: "github",
							callbackURL: window.location.origin,
						})
					}
				>
					<GithubIcon className="h-4 w-4" /> Continue with GitHub
				</Button>
				<Button
					type="button"
					variant="outline"
					onPress={() =>
						authClient.signIn.social({
							provider: "google",
							callbackURL: window.location.origin,
						})
					}
				>
					<Google className="h-4 w-4" /> Continue with Google
				</Button>
			</div>
		</form>
	);
}
