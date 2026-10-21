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
import { Input } from "@org/ui/components/input";
import { Separator } from "@org/ui/components/separator";
import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import { toast } from "sonner";
import { authClient } from "#/features/auth/client";
import { useAutoDismiss } from "#/hooks/use-auto-dismiss";
import { useCooldown } from "#/hooks/use-cooldown";
import { toFieldErrors } from "#/lib/form-errors";
import { AvatarUploader } from "./avatar-uploader";
import { useUpdateProfile } from "./hooks";
import { profileSchema } from "./schema";
import type { AccountUser } from "./types";

type ProfileCardProps = {
	user: AccountUser;
	/** Refetch the session so the sidebar and this card share one source. */
	onUpdated: () => void | Promise<void>;
};

export function ProfileCard({ user, onUpdated }: ProfileCardProps) {
	const updateProfile = useUpdateProfile();
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState<string | null>(null);
	const [resending, setResending] = useState(false);
	const resendCooldown = useCooldown();

	useAutoDismiss(saved, () => setSaved(null));

	const form = useForm({
		defaultValues: { name: user.name },
		// Validate the whole object on submit only. Live feedback comes from
		// the field's own onChange validator, so the input is only flagged
		// once the user has edited it.
		validators: { onSubmit: profileSchema },
		onSubmit: async ({ value }) => {
			setError(null);
			setSaved(null);

			try {
				// Trim before saving so a trailing space never becomes part of
				// the display name.
				const name = value.name.trim();
				await updateProfile.mutateAsync(name);
				await onUpdated();
				// Reset to the saved value so the form is not "dirty" afterwards.
				form.reset({ name });
				setSaved("Profile updated.");
			} catch (submitError) {
				setError(
					submitError instanceof Error
						? submitError.message
						: "Could not update your profile.",
				);
			}
		},
	});

	/**
	 * Send the confirmation mail again.
	 *
	 * Why it lives here: sign up signs the person in straight away, so the
	 * account page is where they land when the mail never arrives. A
	 * confirmed address is what lets them accept an invitation.
	 */
	async function handleResendVerification() {
		if (resending || resendCooldown.isActive) return;

		setResending(true);
		setError(null);

		try {
			const { error: resendError } = await authClient.sendVerificationEmail({
				email: user.email,
			});

			if (resendError) {
				setError(
					resendError.message ?? "Could not resend the verification email.",
				);
				return;
			}

			toast.success("Verification email sent.");
			// Start the wait again so a queued message cannot be spammed.
			resendCooldown.start();
		} catch (resendError) {
			setError(
				resendError instanceof Error
					? resendError.message
					: "Could not resend the verification email.",
			);
		} finally {
			setResending(false);
		}
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Profile</CardTitle>
				<CardDescription>
					Your photo and the name shown to the people you work with.
				</CardDescription>
			</CardHeader>

			<CardContent className="flex flex-col gap-6">
				<AvatarUploader
					image={user.image}
					name={user.name}
					onUploaded={onUpdated}
					onRemoved={onUpdated}
				/>

				<Separator />

				<form
					onSubmit={(event) => {
						event.preventDefault();
						event.stopPropagation();
						form.handleSubmit();
					}}
					className="flex flex-col gap-4"
				>
					<form.Field
						name="name"
						validators={{ onChange: profileSchema.shape.name }}
					>
						{(field) => (
							<Field>
								<FieldLabel htmlFor="account-name">Display name</FieldLabel>
								<Input
									id="account-name"
									type="text"
									autoComplete="name"
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(event) => field.handleChange(event.target.value)}
								/>
								<FieldError errors={toFieldErrors(field.state.meta.errors)} />
								<FieldDescription>Up to 64 characters.</FieldDescription>
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
									{isSubmitting ? "Saving..." : "Save changes"}
								</Button>
							)}
						</form.Subscribe>
					</div>
				</form>

				<Separator />

				<Field>
					<FieldLabel>Email</FieldLabel>
					<div className="flex flex-wrap items-center gap-2">
						<span className="text-sm text-app-text">{user.email}</span>
						<span
							className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold tracking-wide uppercase ${
								user.emailVerified
									? "bg-success-bg text-success"
									: "bg-warning-bg text-warning"
							}`}
						>
							{user.emailVerified ? "Verified" : "Unverified"}
						</span>
					</div>
					<FieldDescription>
						Your email is used to sign in and is not editable here.
					</FieldDescription>
					{!user.emailVerified && (
						<div>
							<Button
								variant="outline"
								size="sm"
								loading={resending}
								isDisabled={resending || resendCooldown.isActive}
								onPress={handleResendVerification}
							>
								{resendCooldown.isActive
									? `Resend in ${resendCooldown.remaining}s`
									: "Resend verification email"}
							</Button>
						</div>
					)}
				</Field>
			</CardContent>
		</Card>
	);
}
