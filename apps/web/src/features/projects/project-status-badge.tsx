/**
 * Project lifecycle badge.
 *
 * Why a component: the table and the project page both show whether a project
 * is active or archived, and both must communicate it with text, never colour
 * alone.
 *
 * Used by: projects-table.tsx and the project page.
 */

import { Badge } from "@org/ui/components/badge";

import type { ProjectRow } from "./api";

export function ProjectStatusBadge({
	status,
}: {
	status: ProjectRow["status"];
}) {
	if (status === "archived") {
		return <Badge className="bg-neutral-bg text-neutral">Archived</Badge>;
	}

	return <Badge className="bg-success-bg text-success">Active</Badge>;
}
