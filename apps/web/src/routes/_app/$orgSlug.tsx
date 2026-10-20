import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/$orgSlug")({
	component: DashboardPage,
	staticData: { breadcrumb: "Dashboard" },
});

function DashboardPage() {
	return (
		<div>
			<h1 className="text-2xl font-bold text-app-text">Dashboard</h1>
			<p className="mt-2 text-app-text-muted">Welcome to your workspace.</p>
		</div>
	);
}
