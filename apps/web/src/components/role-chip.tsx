import { Badge } from "@org/ui/components/badge";
import { cn } from "cn";

import {
	organizationRoleLabel,
	roleParts,
} from "#/features/organization/permissions";

/**
 * Role chip shared by settings, members and invitations.
 *
 * Why a component: the same three roles appear on three pages. One mapping
 * keeps the colour and the label in sync, and every chip carries text, so the
 * role is never communicated by colour alone.
 *
 * Used by: features/members, features/invitations and settings.
 */

const ROLE_STYLES: Record<string, string> = {
	owner: "bg-app-selected text-app-text",
	admin: "bg-info-bg text-info",
	member: "bg-neutral-bg text-neutral",
};

export function RoleChip({
	role,
	className,
}: {
	role: string | null | undefined;
	className?: string;
}) {
	const primary = roleParts(role)[0] ?? "member";

	return (
		<Badge
			className={cn(ROLE_STYLES[primary] ?? ROLE_STYLES.member, className)}
		>
			{organizationRoleLabel(role)}
		</Badge>
	);
}
