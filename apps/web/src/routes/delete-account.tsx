/**
 * Frontend completion page for account deletion.
 *
 * Why this route exists: the delete-account verification email links here
 * (with `?token=...`) instead of the API callback, so the UI owns the
 * confirmation and every error message. The page calls
 * `authClient.deleteUser({ token })` and renders the outcome.
 *
 * Used by: apps/api auth config (sendDeleteAccountVerification).
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
import { useEffect, useState } from "react";
import { authClient } from "#/features/auth/client";

export const Route = createFileRoute("/delete-account")({
	validateSearch: (search: Record<string, unknown>): { token?: string } => {
		const token =
			typeof search.token === "string" && search.token.length > 0
				? search.token
				: undefined;
		return token ? { token } : {};
	},
	head: () => ({
		meta: [
			{ title: "Delete account | Ultra Handoff" },
			{ name: "robots", content: "noindex" },
		],
	}),
	component: DeleteAccountPage,
});

function DeleteAccountPage() {
	const { token } = Route.useSearch();
	const navigate = useNavigate();
	const [status, setStatus] = useState<"idle" | "working" | "done" | "error">(
		"idle",
	);
	const [message, setMessage] = useState<string>("");

	useEffect(() => {
		if (!token) {
			setStatus("error");
			setMessage("This link is missing a token. Request a new one.");
			return;
		}
		if (status !== "idle") return;

		setStatus("working");
		void (async () => {
			const { error } = await authClient.deleteUser({ token });
			if (error) {
				setStatus("error");
				setMessage(
					error.message || "We could not delete your account. Try again.",
				);
				return;
			}
			setStatus("done");
			setMessage("Your account has been deleted.");
		})();
	}, [token, status]);

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
							{status === "done"
								? "Account deleted"
								: status === "error"
									? "Could not delete account"
									: "Deleting account"}
						</CardTitle>
						<CardDescription>
							{status === "working"
								? "Please wait while we remove your account."
								: message}
						</CardDescription>
					</CardHeader>

					<CardContent>
						<div className="flex flex-col gap-3">
							{status !== "working" && (
								<Button variant="outline" onPress={() => navigate({ to: "/" })}>
									Go home
								</Button>
							)}
						</div>
					</CardContent>
				</Card>
			</main>
		</div>
	);
}
