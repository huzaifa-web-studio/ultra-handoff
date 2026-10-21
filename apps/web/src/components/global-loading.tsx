import { Loader2Icon } from "lucide-react";

/**
 * Full-screen loading indicator shown during initial app bootstrap.
 * Used by: the root route component while the page or session is not ready.
 */
export function GlobalLoadingScreen() {
	return (
		<div className="flex min-h-screen items-center justify-center bg-app-canvas">
			<Loader2Icon className="size-8 animate-spin text-app-text-muted" />
		</div>
	);
}
