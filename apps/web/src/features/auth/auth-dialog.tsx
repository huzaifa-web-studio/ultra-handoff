import { Button } from "@org/ui/components/button";
import { Dialog, DialogHeader, DialogTitle } from "@org/ui/components/dialog";
import { useSelector } from "@tanstack/react-store";
import { useEffect } from "react";
import { authClient } from "./client";
import { AuthForgotPasswordForm } from "./forgot-password-form";
import { AuthSignInForm } from "./sign-in-form";
import { AuthSignUpForm } from "./sign-up-form";
import {
	authDialogStore,
	closeAuthDialog,
	openSignIn,
	openSignUp,
} from "./store";

export function AuthDialog() {
	const { isOpen, mode, email } = useSelector(authDialogStore);
	const { data: session } = authClient.useSession();

	useEffect(() => {
		// A signed-in user may still ask for a reset link, for example from an
		// expired link page. Only the sign in and sign up modes close on a
		// session.
		if (session?.user && isOpen && mode !== "forgot") {
			closeAuthDialog();
		}
	}, [session, isOpen, mode]);

	const title =
		mode === "signin"
			? "Sign in"
			: mode === "signup"
				? "Sign up"
				: "Reset password";

	return (
		<Dialog
			isOpen={isOpen}
			onOpenChange={(open) => {
				if (!open) closeAuthDialog();
			}}
		>
			<DialogHeader>
				<DialogTitle>{title}</DialogTitle>
			</DialogHeader>
			{mode === "signin" && <AuthSignInForm />}
			{mode === "signup" && <AuthSignUpForm />}
			{mode === "forgot" && (
				// Keyed by email so a new prefill remounts the form with the
				// carried address instead of keeping stale default values.
				<AuthForgotPasswordForm key={email} defaultEmail={email} />
			)}
			<p className="text-center text-sm text-app-text-muted">
				{mode === "signin" ? (
					<>
						Don&apos;t have an account?{" "}
						<Button
							variant="link"
							className="h-auto px-0 py-0 active:!transform-none"
							onPress={() => {
								closeAuthDialog();
								openSignUp();
							}}
						>
							Sign up
						</Button>
					</>
				) : (
					<>
						{mode === "signup"
							? "Already have an account?"
							: "Remembered your password?"}{" "}
						<Button
							variant="link"
							className="h-auto px-0 py-0 active:!transform-none"
							onPress={() => {
								closeAuthDialog();
								openSignIn();
							}}
						>
							Sign in
						</Button>
					</>
				)}
			</p>
		</Dialog>
	);
}
