import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/$orgSlug/settings")({
	component: SettingsPage,
});

function SettingsPage() {
	return (
		<div>
			<h1 className="text-2xl font-bold text-app-text">Settings</h1>
			<p className="mt-2 text-app-text-muted">Manage your organization.</p>
		</div>
	);
}
