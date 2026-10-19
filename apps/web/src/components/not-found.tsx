import { Button } from "@org/ui/components/button";
import { Link } from "@tanstack/react-router";

export function NotFound() {
	return (
		<div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
			<h1 className="text-4xl font-bold text-app-text">404</h1>
			<p className="text-app-text-muted">
				The page you are looking for does not exist.
			</p>
			<Link to="/">
				<Button>Go home</Button>
			</Link>
		</div>
	);
}
