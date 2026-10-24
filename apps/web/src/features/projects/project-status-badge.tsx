/**
 * Project lifecycle badge.
 *
 * Why a component: the table and the project page both show whether a project
 * is active or archived, and both must communicate it with text, never colour
 * alone. The icon reinforces the label for anyone scanning a list.
 *
 * Used by: projects-table.tsx and the project page.
 */

import { Badge } from "@org/ui/components/badge";
import { ArchiveIcon, CircleCheckIcon } from "lucide-react";

import type { ProjectRow } from "./api";

export function ProjectStatusBadge({
	status,
}: {
	status: ProjectRow["status"];
}) {
	if (status === "archived") {
		return (
			<Badge className="bg-neutral-bg text-neutral">
				<ArchiveIcon aria-hidden />
				Archived
			</Badge>
		);
	}

	return (
		<Badge className="bg-success-bg text-success">
			<CircleCheckIcon aria-hidden />
			Active
		</Badge>
	);
}
