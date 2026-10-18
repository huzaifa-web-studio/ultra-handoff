import { Button } from "@org/ui/components/button";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
	return (
		<div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
			<h1 className="text-4xl font-bold">Shadcn UI works</h1>
			<div className="flex gap-2">
				<Button>Default</Button>
				<Button variant="outline">Outline</Button>
				<Button variant="secondary">Secondary</Button>
			</div>
		</div>
	);
}
