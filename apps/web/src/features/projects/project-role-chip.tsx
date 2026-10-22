/**
 * Project role chip.
 *
 * Why not the organization RoleChip: project roles add `client`, and the label
 * and colour map differs from the workspace roles. Keeping a separate chip
 * avoids teaching the organization chip a role it never receives.
 *
 * Used by: the projects table and the project members dialog.
 */

import { Badge } from "@org/ui/components/badge";
import { cn } from "cn";

import { projectRoleLabel } from "./permissions";

const ROLE_STYLES: Record<string, string> = {
	owner: "bg-app-selected text-app-text",
	admin: "bg-info-bg text-info",
	member: "bg-neutral-bg text-neutral",
	client: "bg-app-panel-subtle text-app-text-muted",
};

export function ProjectRoleChip({
	role,
	className,
}: {
	role: string;
	className?: string;
}) {
	return (
		<Badge className={cn(ROLE_STYLES[role] ?? ROLE_STYLES.member, className)}>
			{projectRoleLabel(role)}
		</Badge>
	);
}
