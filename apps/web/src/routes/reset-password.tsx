/**
 * Public reset password page.
 *
 * Why a separate top level route: the emailed link lands here after the API
 * validates it, and the user is usually signed out. It must not be behind the
 * `_app` layout or the organization guard.
 *
 * The API redirect adds either `?token=<token>` or `?error=INVALID_TOKEN`.
 *
 * Used by: the reset password email and the auth dialog.
 */

import { Button } from "@org/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@org/ui/components/card";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AuthDialog } from "#/features/auth/auth-dialog";
import { ResetPasswordForm } from "#/features/auth/reset-password-form";
import { openForgotPassword, openSignIn } from "#/features/auth/store";

export const Route = createFileRoute("/reset-password")({
	validateSearch: (
		search: Record<string, unknown>,
	): { token?: string; error?: string } => {
		const token =
			typeof search.token === "string" && search.token.length > 0
				? search.token
				: undefined;
		const error =
			typeof search.error === "string" && search.error.length > 0
				? search.error
				: undefined;

		return {
			...(token ? { token } : {}),
			...(error ? { error } : {}),
		};
	},
	head: () => ({
		meta: [
			{ title: "Reset password | Ultra Handoff" },
			// Reset links should never be indexed or cached by search engines.
			{ name: "robots", content: "noindex" },
		],
	}),
	component: ResetPasswordPage,
});

function ResetPasswordPage() {
	const { token, error } = Route.useSearch();
	const navigate = useNavigate();
	const canReset = Boolean(token) && error !== "INVALID_TOKEN";

	return (
		<div className="flex min-h-screen flex-col bg-app-canvas">
			<header className="border-b border-app-border px-6 py-4">
				<span className="font-display text-lg font-bold text-app-text">
					Ultra Handoff
				</span>
			</header>

			<main className="flex flex-1 items-center justify-center px-6 py-12">
				<Card className="w-full max-w-md">
					<CardHeader>
						<CardTitle>
							{canReset ? "Set a new password" : "Link expired"}
						</CardTitle>
						<CardDescription>
							{canReset
								? "Choose a new password for your account. The link can only be used once."
								: "This reset link is invalid, expired, or already used."}
						</CardDescription>
					</CardHeader>

					<CardContent>
						{canReset && token ? (
							<ResetPasswordForm
								token={token}
								onRequestNewLink={() => openForgotPassword()}
							/>
						) : (
							<div className="flex flex-col gap-4">
								<p className="text-sm text-app-text-muted">
									Reset links expire after one hour and can only be used once.
									Request a new link and check your inbox.
								</p>
								<Button onPress={() => openForgotPassword()}>
									Request a new link
								</Button>
								<Button
									variant="outline"
									onPress={() => {
										navigate({ to: "/" });
										openSignIn();
									}}
								>
									Back to sign in
								</Button>
							</div>
						)}
					</CardContent>
				</Card>
			</main>

			{/* Needed so "Request a new link" can open the email form here. */}
			<AuthDialog />
		</div>
	);
}
