import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useCooldown } from "#/hooks/use-cooldown";
import { authClient } from "./client";

/**
 * Send a verification email again.
 *
 * Why one hook: sign up, a blocked sign in and the verify page all offer the
 * same action, and all three need the same cooldown and error handling. Keeping
 * it here means the cooldown cannot drift between surfaces, and the account
 * card uses the same implementation instead of its own copy.
 *
 * Used by: features/auth/sign-up-form.tsx, features/auth/sign-in-form.tsx,
 * features/auth/verify-email-card.tsx and features/account/profile-card.tsx.
 */
export function useVerificationResend() {
	const cooldown = useCooldown();
	const [sending, setSending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const resend = useCallback(
		async (email: string) => {
			// The server also throttles this, but stopping here keeps a queued
			// message from being sent twice by an impatient click.
			if (sending || cooldown.isActive) return;

			const address = email.trim();

			if (!address) {
				setError("Enter the email address you signed up with.");
				return;
			}

			setSending(true);
			setError(null);

			try {
				const { error: sendError } = await authClient.sendVerificationEmail({
					email: address,
				});

				if (sendError) {
					setError(
						sendError.message ?? "Could not send the verification email.",
					);
					return;
				}

				toast.success("Verification email sent.");
				cooldown.start();
			} catch (sendError) {
				setError(
					sendError instanceof Error
						? sendError.message
						: "Could not send the verification email.",
				);
			} finally {
				setSending(false);
			}
		},
		[cooldown, sending],
	);

	return { resend, sending, cooldown, error };
}
