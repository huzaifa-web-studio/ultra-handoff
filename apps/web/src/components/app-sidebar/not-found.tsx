import { Button } from "@org/ui/components/button";
import { useNavigate } from "@tanstack/react-router";

export function AppNotFound() {
	const navigate = useNavigate();
	return (
		<div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
			<h1 className="text-4xl font-bold text-app-text">404</h1>
			<p className="text-app-text-muted">
				The page you are looking for does not exist.
			</p>
			<Button onPress={() => navigate({ to: "/app" })}>Go to Dashboard</Button>
		</div>
	);
}
