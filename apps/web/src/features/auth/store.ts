import { Store } from "@tanstack/store";

export type AuthDialogMode = "signin" | "signup";

export type AuthDialogState = {
	isOpen: boolean;
	mode: AuthDialogMode;
};

export const authDialogStore = new Store<AuthDialogState>({
	isOpen: false,
	mode: "signin",
});

export function openSignIn() {
	authDialogStore.setState(() => ({ isOpen: true, mode: "signin" }));
}

export function openSignUp() {
	authDialogStore.setState(() => ({ isOpen: true, mode: "signup" }));
}

export function closeAuthDialog() {
	authDialogStore.setState((s) => ({ ...s, isOpen: false }));
}
