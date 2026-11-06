import { Button } from "@org/ui/components/button";
import { Card, CardContent } from "@org/ui/components/card";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { authClient } from "#/features/auth/client";
import { openSignIn } from "#/features/auth/store";
import { VerifyEmailCard } from "#/features/auth/verify-email-card";

/**
 * Landing page for the emailed verification link.
 *
 * Why a dedicated route: Better Auth sends the browser back here with
 * `verified=1` on success and appends `error=...` when the token is expired or
 * invalid. Reading both in one place is what stops a dead link from being
 * reported as a confirmation, which the old home page toast did.
 *
 * Used by: apps/api/src/auth/auth.ts (emailVerification callback URL).
 */
export const Route = createFileRoute("/verify-email")({
	/**
	 * Both flags come from the URL, so they are parsed into typed values before
	 * the page can render. `verified=1` is what our callback sets, while
	 * `error` is what Better Auth appends on failure.
	 */
	validateSearch: (
		search: Record<string, unknown>,
	): { verified?: boolean; error?: string } => {
		const verified = search.verified === "1" || search.verified === true;
		const error =
			typeof search.error === "string" && search.error.length > 0
				? search.error
				: undefined;

		return {
			...(verified ? { verified } : {}),
			...(error ? { error } : {}),
		};
	},
	head: () => ({
		meta: [
			{ title: "Verify your email | Ultra Handoff" },
			{ name: "robots", content: "noindex" },
		],
	}),
	component: VerifyEmailPage,
});

function VerifyEmailPage() {
	const navigate = useNavigate();
	const { verified, error } = Route.useSearch();
	const { data: session, isPending } = authClient.useSession();

	// An error always wins. A dead token still arrives with `verified=1`
	// because that flag lives inside the callback URL, so ordering matters.
	const state = error ? "error" : verified ? "success" : "pending";

	const toastShown = useRef(false);

	useEffect(() => {
		if (state !== "success" || toastShown.current) return;

		toastShown.current = true;
		toast.success("Email verified. Your account is ready.");
	}, [state]);

	/**
	 * Move on after a successful verification.
	 *
	 * Opening the link signs the account in (`autoSignInAfterVerification`), so
	 * the common case is a session already being present. If cookies were
	 * blocked, fall back to the sign-in dialog instead of dropping the person
	 * on a page that looks empty.
	 */
	function handleContinue() {
		// The session hook resolves after the first paint. Doing nothing for
		// that moment is safer than guessing and opening the sign-in dialog for
		// someone who is already signed in.
		if (isPending) return;

		if (session?.user) {
			navigate({ to: "/" });
			return;
		}

		openSignIn();
		navigate({ to: "/" });
	}

	return (
		<div className="flex min-h-screen flex-col bg-app-canvas">
			<header className="border-b border-app-border px-6 py-4">
				<span className="font-display text-lg font-bold text-app-text">
					Ultra Handoff
				</span>
			</header>

			<main className="flex flex-1 items-center justify-center px-6 py-12">
				<Card className="w-full max-w-md">
					<CardContent className="pt-6">
						<div className="flex flex-col gap-4">
							<VerifyEmailCard
								state={state}
								hint={
									state === "error"
										? "If you recently signed up, request a new link and open it within one hour."
										: undefined
								}
								onContinue={handleContinue}
								continueDisabled={isPending}
								continueLabel={
									isPending
										? "Please wait..."
										: session?.user
											? "Continue"
											: "Go to sign in"
								}
							/>

							<Button
								variant="ghost"
								onPress={() => {
									navigate({ to: "/" });
								}}
							>
								Back to Handoff
							</Button>
						</div>
					</CardContent>
				</Card>
			</main>
		</div>
	);
}
