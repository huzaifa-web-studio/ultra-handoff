/**
 * Shared user avatar.
 *
 * Why one component: avatars appear in the sidebar, the account page and
 * future member lists. Centralising the URL resolution and the initials
 * fallback means a change to how images are stored only touches this file.
 *
 * Used by: src/components/app-sidebar/nav-user.tsx and the account feature.
 */

import { Avatar, AvatarFallback, AvatarImage } from "@org/ui/components/avatar";

import { resolveAssetUrl } from "#/lib/files";

type UserAvatarProps = {
	/** Stored image value: `/files/...`, an external URL, or empty. */
	src?: string | null;
	/** Display name, used for the accessible label and the initials. */
	name: string;
	size?: "sm" | "default" | "lg" | "xl";
	className?: string;
};

/** Build up to two initials, with a stable fallback for an empty name. */
function initialsFor(name: string): string {
	const words = name.trim().split(/\s+/).filter(Boolean);

	if (words.length === 0) return "?";
	if (words.length === 1) return words[0]?.slice(0, 2).toUpperCase() ?? "?";

	return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`.toUpperCase();
}

export function UserAvatar({
	src,
	name,
	size = "default",
	className,
}: UserAvatarProps) {
	const resolvedSrc = resolveAssetUrl(src);

	return (
		<Avatar size={size} className={className}>
			{/*
			 * The key is intentional. AvatarImage keeps its loading state in
			 * component state, so changing `src` alone would leave a previously
			 * failed image stuck on the fallback. Remounting on every src change
			 * lets a new avatar appear immediately.
			 */}
			<AvatarImage
				key={resolvedSrc ?? "fallback"}
				src={resolvedSrc}
				alt={name}
			/>
			<AvatarFallback>{initialsFor(name)}</AvatarFallback>
		</Avatar>
	);
}
