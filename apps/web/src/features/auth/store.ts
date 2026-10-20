import { Store } from "@tanstack/store";

export type AuthDialogMode = "signin" | "signup" | "forgot";

export type AuthDialogState = {
	isOpen: boolean;
	mode: AuthDialogMode;
	/**
	 * Email carried from the sign-in form into the forgot password form.
	 * Empty when the flow starts somewhere else, for example an expired
	 * reset link.
	 */
	email: string;
};

export const authDialogStore = new Store<AuthDialogState>({
	isOpen: false,
	mode: "signin",
	email: "",
});

export function openSignIn() {
	authDialogStore.setState(() => ({
		isOpen: true,
		mode: "signin",
		email: "",
	}));
}

export function openSignUp() {
	authDialogStore.setState(() => ({
		isOpen: true,
		mode: "signup",
		email: "",
	}));
}

/**
 * Open the forgot password form.
 *
 * The optional email is prefilled from sign in so the user does not have to
 * type the address twice.
 */
export function openForgotPassword(email = "") {
	authDialogStore.setState(() => ({
		isOpen: true,
		mode: "forgot",
		email: email.trim(),
	}));
}

export function closeAuthDialog() {
	authDialogStore.setState((s) => ({ ...s, isOpen: false }));
}
