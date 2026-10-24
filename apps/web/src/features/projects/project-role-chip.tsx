/**
 * Project role chip.
 *
 * Why not the organization RoleChip: project roles add `client`, and the label
 * and colour map differs from the workspace roles. Keeping a separate chip
 * avoids teaching the organization chip a role it never receives.
 *
 * The icon makes the four roles readable at a glance in a dense member list.
 *
 * Used by: the projects table and the project members dialog.
 */

import { Badge } from "@org/ui/components/badge";
import { cn } from "cn";
import {
	BriefcaseIcon,
	CrownIcon,
	type LucideIcon,
	ShieldIcon,
	UserIcon,
} from "lucide-react";

import { projectRoleLabel } from "./permissions";

const ROLE_STYLES: Record<string, string> = {
	owner: "bg-app-selected text-app-text",
	admin: "bg-info-bg text-info",
	member: "bg-neutral-bg text-neutral",
	client: "bg-app-panel-subtle text-app-text-muted",
};

/** One icon per project role. Member is also the fallback for unknown roles. */
const ROLE_ICONS: Record<string, LucideIcon> = {
	owner: CrownIcon,
	admin: ShieldIcon,
	member: UserIcon,
	client: BriefcaseIcon,
};

export function ProjectRoleChip({
	role,
	className,
}: {
	role: string;
	className?: string;
}) {
	const Icon = ROLE_ICONS[role] ?? UserIcon;

	return (
		<Badge className={cn(ROLE_STYLES[role] ?? ROLE_STYLES.member, className)}>
			<Icon aria-hidden />
			{projectRoleLabel(role)}
		</Badge>
	);
}
