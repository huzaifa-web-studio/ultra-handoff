/**
 * Frontend landing page for Better Auth redirect-style errors.
 *
 * Why this route exists: Better Auth's `onAPIError.errorURL` points here, so
 * every browser redirect flow that fails (OAuth callback, email verification,
 * password reset, delete-account verification, validateUserInfo rejection)
 * ends up on the UI instead of the API's built-in error page. The query
 * string carries `error` (a Better Auth code) and optionally
 * `error_description` (a human readable message).
 *
 * Used by: apps/api auth config (onAPIError.errorURL).
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

/**
 * Map well-known Better Auth error codes to friendly copy. Unknown codes fall
 * back to `error_description` and then to the raw code.
 */
const ERROR_MESSAGES: Record<string, string> = {
	INVALID_TOKEN: "This link is invalid, expired, or already used.",
	TOKEN_EXPIRED: "This link has expired. Request a new one.",
	USER_NOT_FOUND: "We could not find an account for this request.",
	FAILED_TO_GET_USER_INFO:
		"We could not load your account. Please sign in again.",
	SESSION_EXPIRED: "Your session expired. Please sign in again.",
	account_not_linked:
		"This account is not linked to your profile. Link it from account settings.",
	internal_server_error: "Something went wrong on our side. Please try again.",
};

export const Route = createFileRoute("/auth/error")({
	validateSearch: (
		search: Record<string, unknown>,
	): { error?: string; error_description?: string; callbackURL?: string } => {
		const error =
			typeof search.error === "string" && search.error.length > 0
				? search.error
				: undefined;
		const error_description =
			typeof search.error_description === "string" &&
			search.error_description.length > 0
				? search.error_description
				: undefined;
		const callbackURL =
			typeof search.callbackURL === "string" && search.callbackURL.length > 0
				? search.callbackURL
				: undefined;

		return {
			...(error ? { error } : {}),
			...(error_description ? { error_description } : {}),
			...(callbackURL ? { callbackURL } : {}),
		};
	},
	head: () => ({
		meta: [
			{ title: "Something went wrong | Ultra Handoff" },
			{ name: "robots", content: "noindex" },
		],
	}),
	component: AuthErrorPage,
});

function AuthErrorPage() {
	const { error, error_description, callbackURL } = Route.useSearch();
	const navigate = useNavigate();

	const message =
		(error && ERROR_MESSAGES[error]) ||
		error_description ||
		(error ? `Error: ${error}` : "Something went wrong. Please try again.");

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
						<CardTitle>Something went wrong</CardTitle>
						<CardDescription>{message}</CardDescription>
					</CardHeader>

					<CardContent>
						<div className="flex flex-col gap-3">
							<Button
								onPress={() => {
									if (callbackURL) {
										navigate({ to: callbackURL as never });
									} else {
										navigate({ to: "/" });
									}
								}}
							>
								Back
							</Button>
							<Button
								variant="outline"
								onPress={() => {
									navigate({ to: "/" });
								}}
							>
								Go home
							</Button>
						</div>
					</CardContent>
				</Card>
			</main>
		</div>
	);
}
