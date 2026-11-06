import { Badge } from "@org/ui/components/badge";
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
import { FieldMeta } from "#/components/field-meta";
import { useVerificationResend } from "#/features/auth/use-verification-resend";
import { useAutoDismiss } from "#/hooks/use-auto-dismiss";
import { toFieldErrors } from "#/lib/form-errors";
import { USER_NAME_MAX } from "#/lib/limits";
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
	 * Why it stays here: sign up and sign in own the normal resend path, but a
	 * session from before verification became mandatory can still open this
	 * card. The shared hook keeps one implementation across all three.
	 */
	const verification = useVerificationResend();

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
									maxLength={USER_NAME_MAX}
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(event) => field.handleChange(event.target.value)}
								/>
								<FieldError errors={toFieldErrors(field.state.meta.errors)} />
								<FieldMeta
									counter={{
										current: field.state.value.length,
										max: USER_NAME_MAX,
									}}
								>
									The name your team and clients see.
								</FieldMeta>
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
						<Badge
							className={
								user.emailVerified
									? "bg-success-bg text-success"
									: "bg-warning-bg text-warning"
							}
						>
							{user.emailVerified ? "Verified" : "Unverified"}
						</Badge>
					</div>
					<FieldDescription>
						Your email is used to sign in and is not editable here.
					</FieldDescription>
					{!user.emailVerified && (
						<div className="flex flex-col gap-2">
							<Button
								variant="outline"
								size="sm"
								loading={verification.sending}
								isDisabled={
									verification.sending || verification.cooldown.isActive
								}
								onPress={() => void verification.resend(user.email)}
							>
								{verification.cooldown.isActive
									? `Resend in ${verification.cooldown.remaining}s`
									: "Resend verification email"}
							</Button>
							{verification.error && (
								<p role="alert" className="text-sm text-danger">
									{verification.error}
								</p>
							)}
						</div>
					)}
				</Field>
			</CardContent>
		</Card>
	);
}
