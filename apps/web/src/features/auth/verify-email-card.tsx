import { Button } from "@org/ui/components/button";
import { Field, FieldError, FieldLabel } from "@org/ui/components/field";
import { Input } from "@org/ui/components/input";
import { MailIcon } from "lucide-react";
import { useState } from "react";
import { EMAIL_MAX } from "#/lib/limits";
import { signInSchema } from "./schema";
import { useVerificationResend } from "./use-verification-resend";

/** The three states a verification surface can be in. */
export type VerifyEmailState = "pending" | "success" | "error";

type VerifyEmailCardProps = {
	state: VerifyEmailState;
	/** Address the link was sent to, when the caller knows it. */
	email?: string;
	/** One extra sentence for context, such as the invitation it unblocks. */
	hint?: string;
	/** Primary action shown in the success state. Omitted on inline surfaces. */
	onContinue?: () => void;
	continueLabel?: string;
	/** Keeps the success action inert while the session is still resolving. */
	continueDisabled?: boolean;
};

const COPY: Record<VerifyEmailState, { title: string; description: string }> = {
	pending: {
		title: "Check your inbox",
		description:
			"We sent you a verification link. Open it to finish and you will be signed in automatically. The link expires in one hour.",
	},
	success: {
		title: "Email verified",
		description: "Your address is confirmed. Your account is ready to use.",
	},
	error: {
		title: "This link is invalid or expired",
		description:
			"Verification links expire after one hour and can only be used once. Request a new one and open it within the hour.",
	},
};

/**
 * Shared "confirm your email" panel.
 *
 * Why a component instead of three copies: sign up, a blocked sign in and the
 * verify page all need the same copy, the same resend action and the same
 * cooldown. The panel renders without its own Card so a dialog can drop it in
 * directly while the verify route wraps it in one.
 *
 * Used by: features/auth/sign-up-form.tsx, features/auth/sign-in-form.tsx and
 * routes/verify-email.tsx.
 */
export function VerifyEmailCard({
	state,
	email,
	hint,
	onContinue,
	continueLabel = "Continue",
	continueDisabled = false,
}: VerifyEmailCardProps) {
	const { resend, sending, cooldown, error } = useVerificationResend();
	const [address, setAddress] = useState(email ?? "");
	const [fieldError, setFieldError] = useState<string | null>(null);

	const copy = COPY[state];
	// A known address can be shown as text. The error state still exposes an
	// editable field because the link carries no address, and the person may
	// have mistyped it the first time.
	const needsInput = state === "error" || !email;

	function handleResend() {
		const parsed = signInSchema.shape.email.safeParse(address.trim());

		if (!parsed.success) {
			setFieldError(
				parsed.error.issues[0]?.message ?? "Enter a valid email address.",
			);
			return;
		}

		setFieldError(null);
		void resend(parsed.data);
	}

	return (
		<div aria-live="polite" className="flex flex-col gap-4">
			<div className="flex flex-col gap-2">
				<h2 className="text-lg font-bold text-app-text">{copy.title}</h2>
				<p className="text-sm text-app-text-muted">{copy.description}</p>
				{state === "pending" && email && (
					<p className="text-sm font-medium text-app-text">{email}</p>
				)}
				{hint && <p className="text-xs text-app-text-muted">{hint}</p>}
			</div>

			{state === "success" ? (
				onContinue && (
					<Button isDisabled={continueDisabled} onPress={onContinue}>
						{continueLabel}
					</Button>
				)
			) : (
				<div className="flex flex-col gap-3">
					{needsInput && (
						<Field>
							<FieldLabel>Email</FieldLabel>
							<Input
								type="email"
								autoComplete="email"
								maxLength={EMAIL_MAX}
								value={address}
								onChange={(event) => setAddress(event.target.value)}
							/>
							<FieldError
								errors={fieldError ? [{ message: fieldError }] : []}
							/>
						</Field>
					)}
					<Button
						variant={state === "pending" ? "outline" : "default"}
						loading={sending}
						isDisabled={sending || cooldown.isActive}
						onPress={handleResend}
					>
						<MailIcon aria-hidden />
						{cooldown.isActive
							? `Resend in ${cooldown.remaining}s`
							: "Resend verification email"}
					</Button>
					{error && (
						<p role="alert" className="text-sm text-danger">
							{error}
						</p>
					)}
				</div>
			)}
		</div>
	);
}
