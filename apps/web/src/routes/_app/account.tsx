import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/account")({
	component: AccountPage,
});

function AccountPage() {
	return (
		<div>
			<h1 className="text-2xl font-bold text-app-text">Account</h1>
			<p className="mt-2 text-app-text-muted">Manage your account settings.</p>
		</div>
	);
}
