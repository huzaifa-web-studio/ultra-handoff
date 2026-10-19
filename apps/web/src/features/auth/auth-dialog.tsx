import { Button } from "@org/ui/components/button";
import { Dialog, DialogHeader, DialogTitle } from "@org/ui/components/dialog";
import { useSelector } from "@tanstack/react-store";
import { AuthSignInForm } from "./sign-in-form";
import { AuthSignUpForm } from "./sign-up-form";
import {
	authDialogStore,
	closeAuthDialog,
	openSignIn,
	openSignUp,
} from "./store";

export function AuthDialog() {
	const { isOpen, mode } = useSelector(authDialogStore);
	const isSignIn = mode === "signin";

	return (
		<Dialog
			isOpen={isOpen}
			onOpenChange={(open) => {
				if (!open) closeAuthDialog();
			}}
		>
			<DialogHeader>
				<DialogTitle>{isSignIn ? "Sign in" : "Sign up"}</DialogTitle>
			</DialogHeader>
			{isSignIn ? <AuthSignInForm /> : <AuthSignUpForm />}
			<p className="text-center text-sm text-app-text-muted">
				{isSignIn ? (
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
						Already have an account?{" "}
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
