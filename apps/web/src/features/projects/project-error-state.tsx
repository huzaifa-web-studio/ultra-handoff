/**
 * Project workspace load failure.
 *
 * Why a component: every project tab needs the same "not found or no access"
 * surface. It offers a retry and a way back to the full projects list, so a bad
 * slug or lost membership never traps the caller.
 *
 * Used by: project-workspace.tsx.
 */

import { Button } from "@org/ui/components/button";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeftIcon, RefreshCwIcon } from "lucide-react";

export function ProjectErrorState({
	message,
	onRetry,
	orgSlug,
}: {
	message: string;
	onRetry: () => void;
	orgSlug: string;
}) {
	const navigate = useNavigate();

	return (
		<div
			role="alert"
			className="flex w-full max-w-3xl flex-col items-start gap-3 border border-danger bg-danger-bg p-4"
		>
			<p className="text-sm text-danger">{message}</p>
			<div className="flex flex-wrap gap-2">
				<Button variant="surface" onPress={onRetry}>
					<RefreshCwIcon aria-hidden />
					Try again
				</Button>
				<Button
					variant="outline"
					onPress={() =>
						navigate({ to: "/$orgSlug/projects", params: { orgSlug } })
					}
				>
					<ArrowLeftIcon aria-hidden />
					All projects
				</Button>
			</div>
		</div>
	);
}
