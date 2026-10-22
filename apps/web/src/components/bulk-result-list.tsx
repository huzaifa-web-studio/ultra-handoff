/**
 * Per item outcomes for a bulk action.
 *
 * Why one component: adding members to a project and deleting projects both
 * answer with a list of successes, skips and failures. Rendering that list in
 * one place keeps the icons, colours and copy consistent, and means a new bulk
 * action does not need its own result markup.
 *
 * Used by: features/projects/bulk-delete-projects-dialog.tsx and
 * features/projects/project-members-dialog.tsx.
 */

import { AlertCircle, CheckCircle2, XCircle } from "lucide-react";

/** The fields this list needs. Any bulk response row fits. */
export type BulkResultRow = {
	key: string;
	label: string;
	status: string;
	message: string;
};

/** Statuses that mean the action succeeded. */
const SUCCESS_STATUSES = new Set([
	"added",
	"archived",
	"canceled",
	"deleted",
	"invited",
	"removed",
	"resent",
	"restored",
	"updated",
]);

export function BulkResultList({
	results,
	label = "Bulk action results",
}: {
	results: BulkResultRow[];
	label?: string;
}) {
	return (
		<ul
			aria-label={label}
			className="flex max-h-56 flex-col gap-2 overflow-y-auto"
		>
			{results.map((result) => {
				const success = SUCCESS_STATUSES.has(result.status);
				const skipped = result.status === "skipped";

				return (
					<li key={result.key} className="flex items-start gap-2 text-sm">
						{success ? (
							<CheckCircle2
								className="mt-0.5 size-4 shrink-0 text-success"
								aria-hidden
							/>
						) : skipped ? (
							<AlertCircle
								className="mt-0.5 size-4 shrink-0 text-warning"
								aria-hidden
							/>
						) : (
							<XCircle
								className="mt-0.5 size-4 shrink-0 text-danger"
								aria-hidden
							/>
						)}
						<span className="min-w-0">
							<span className="block truncate font-medium text-app-text">
								{result.label}
							</span>
							<span className="block text-xs text-app-text-muted">
								{result.message}
							</span>
						</span>
					</li>
				);
			})}
		</ul>
	);
}
