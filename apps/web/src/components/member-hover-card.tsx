"use client";

/**
 * Member avatar with a profile preview.
 *
 * Why one component instead of wrapping avatars ad hoc: the preview has to be
 * consistent, keyboard accessible and cached with the profile page. `MemberAvatar`
 * owns all three, so a call site only adds the person's id.
 *
 * Behaviour:
 *   - the avatar is a link to the full profile, so the card is an addition, not
 *     the only way to reach the person
 *   - the card content mounts only while it is open, so nothing is requested
 *     for avatars the reader never hovers
 *   - the request uses the same query key as the profile page, so hovering then
 *     clicking renders the page from cache
 *   - hover, keyboard focus and long press all open it through React Aria's
 *     PreviewTrigger, with Escape to close
 *
 * The workspace slug comes from the active organization. The `_app` layout
 * redirects any URL that names a different workspace, so the two always agree.
 *
 * Used by: comments, mentions, assignee stacks and every member list.
 */

import { buttonVariants } from "@org/ui/components/button";
import { HoverCard, HoverCardTrigger } from "@org/ui/components/hover-card";
import { Skeleton } from "@org/ui/components/skeleton";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { CalendarIcon, MapPinIcon } from "lucide-react";
import {
	type ComponentProps,
	type ReactNode,
	useCallback,
	useEffect,
	useState,
} from "react";
import { Focusable } from "react-aria-components";

import { RoleChip } from "#/components/role-chip";
import { UserAvatar } from "#/components/user-avatar";
import { authClient } from "#/features/auth/client";
import { useMemberProfile } from "#/features/people/hooks";
import { ApiRequestError } from "#/lib/api";
import { formatDate } from "#/lib/date";

type MemberAvatarProps = {
	/** Better Auth user id. Without it the avatar stays a plain avatar. */
	userId?: string | null;
	name: string;
	src?: string | null;
	size?: "sm" | "default" | "lg" | "xl";
	shape?: "circle" | "square";
	className?: string;
};

/** How long the pointer must rest before the card opens. */
const OPEN_DELAY_MS = 400;

/** How long the card stays after the pointer leaves, so it can be entered. */
const CLOSE_DELAY_MS = 150;

export function MemberAvatar({
	userId,
	name,
	src,
	size = "default",
	shape = "circle",
	className,
}: MemberAvatarProps) {
	const { data: activeOrg } = authClient.useActiveOrganization();
	const orgSlug = activeOrg?.slug ?? "";

	const avatar = (
		<UserAvatar
			src={src}
			name={name}
			size={size}
			shape={shape}
			className={className}
		/>
	);

	// A missing id or workspace (sign-in transitions) must not produce a link
	// to nowhere.
	if (!userId || !orgSlug) return avatar;

	const linkClass = cn(
		"inline-flex shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-focus",
		shape === "circle" ? "rounded-full" : "rounded-none",
	);

	return (
		<MemberProfileTrigger
			orgSlug={orgSlug}
			userId={userId}
			name={name}
			image={src}
			className={linkClass}
			ariaLabel={`View profile for ${name}`}
		>
			{avatar}
		</MemberProfileTrigger>
	);
}

/**
 * The profile link and its preview, with a disabled state once the person is
 * known to have left.
 *
 * Why the state lives here: the trigger must stay the same element while the
 * card is open. TanStack's `Link` supports `disabled`, which removes the href
 * and keeps the anchor in place, so the popover does not remount when a 404
 * turns the trigger into a non-navigating element. A person who left still gets
 * the card explaining the state, but no click into a 404 page.
 */
export function MemberProfileTrigger({
	orgSlug,
	userId,
	name,
	image,
	className,
	ariaLabel,
	children,
}: {
	orgSlug: string;
	userId: string;
	name: string;
	image?: string | null;
	className: string;
	ariaLabel: string;
	children: ReactNode;
}) {
	const [missing, setMissing] = useState(false);
	const handleMissing = useCallback(() => setMissing(true), []);

	return (
		<MemberProfileHover
			orgSlug={orgSlug}
			userId={userId}
			name={name}
			image={image}
			onMissing={handleMissing}
		>
			<Link
				to="/$orgSlug/people/$userId"
				params={{ orgSlug, userId }}
				disabled={missing}
				aria-label={
					missing ? `${name} is no longer in this workspace` : ariaLabel
				}
				className={cn(className, missing && "cursor-default")}
			>
				{children}
			</Link>
		</MemberProfileHover>
	);
}

/**
 * Wrap any trigger with the profile preview.
 *
 * Exported separately so a mention chip can open the same card without
 * pretending to be an avatar. The trigger must be one focusable element, which
 * is what React Aria's `Focusable` clones.
 */
export function MemberProfileHover({
	orgSlug,
	userId,
	name,
	image,
	onMissing,
	children,
}: {
	orgSlug: string;
	userId: string;
	name: string;
	image?: string | null;
	/** Called once a 404 proves the person is no longer in the workspace. */
	onMissing?: () => void;
	children: ComponentProps<typeof Focusable>["children"];
}) {
	return (
		<HoverCardTrigger delay={OPEN_DELAY_MS} closeDelay={CLOSE_DELAY_MS}>
			<Focusable>{children}</Focusable>

			<HoverCard className="w-80 p-4">
				<MemberProfileCard
					orgSlug={orgSlug}
					userId={userId}
					fallbackName={name}
					fallbackImage={image}
					onMissing={onMissing}
				/>
			</HoverCard>
		</HoverCardTrigger>
	);
}

/**
 * The card body.
 *
 * Kept separate so the query only exists while the popover is mounted. The
 * fallback props render immediately, before the first response, so the card
 * never looks empty.
 */
function MemberProfileCard({
	orgSlug,
	userId,
	fallbackName,
	fallbackImage,
	onMissing,
}: {
	orgSlug: string;
	userId: string;
	fallbackName: string;
	fallbackImage?: string | null;
	onMissing?: () => void;
}) {
	const query = useMemberProfile(orgSlug, userId);
	const missing =
		query.isError &&
		query.error instanceof ApiRequestError &&
		query.error.status === 404;

	// Tell the trigger that this person left, so it can stop being a link.
	// The card stays open and keeps explaining the state.
	useEffect(() => {
		if (missing) onMissing?.();
	}, [missing, onMissing]);

	if (query.isPending) {
		return (
			<div className="flex flex-col gap-3" aria-busy="true">
				<span className="sr-only">Loading profile</span>
				<div className="flex items-center gap-3">
					<UserAvatar src={fallbackImage} name={fallbackName} />
					<div className="flex flex-1 flex-col gap-1.5">
						<Skeleton className="h-4 w-32" />
						<Skeleton className="h-3 w-24" />
					</div>
				</div>
				<Skeleton className="h-3 w-full" />
				<Skeleton className="h-3 w-2/3" />
			</div>
		);
	}

	if (query.isError) {
		return (
			<div className="flex flex-col gap-3">
				<div className="flex items-center gap-3">
					<UserAvatar src={fallbackImage} name={fallbackName} />
					<div className="min-w-0">
						<p className="truncate text-sm font-semibold text-app-text">
							{fallbackName}
						</p>
						<p className="text-xs text-app-text-muted">
							{missing ? "No longer in this workspace" : "Profile unavailable"}
						</p>
					</div>
				</div>
				{!missing && (
					<Link
						to="/$orgSlug/people/$userId"
						params={{ orgSlug, userId }}
						className={cn(
							buttonVariants({ variant: "outline", size: "sm" }),
							"w-full",
						)}
					>
						Open profile
					</Link>
				)}
			</div>
		);
	}

	const profile = query.data;
	const previewProjects = profile.projects.slice(0, 3);
	const remainingProjects = profile.projects.length - previewProjects.length;

	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-start gap-3">
				<UserAvatar src={profile.image} name={profile.name} size="lg" />
				<div className="min-w-0 flex-1">
					<p className="truncate text-sm font-semibold text-app-text">
						{profile.name}
					</p>
					{profile.jobTitle && (
						<p className="truncate text-xs text-app-text-muted">
							{profile.jobTitle}
						</p>
					)}
					<div className="mt-1">
						<RoleChip role={profile.role} />
					</div>
				</div>
			</div>

			{profile.bio && (
				<p className="line-clamp-2 text-xs leading-relaxed text-app-text-muted">
					{profile.bio}
				</p>
			)}

			<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-app-text-muted">
				<span className="inline-flex items-center gap-1">
					<CalendarIcon aria-hidden className="size-3" />
					Member since {formatDate(profile.joinedAt)}
				</span>
				{profile.location && (
					<span className="inline-flex min-w-0 items-center gap-1">
						<MapPinIcon aria-hidden className="size-3 shrink-0" />
						<span className="truncate">{profile.location}</span>
					</span>
				)}
			</div>

			{previewProjects.length > 0 && (
				<div className="flex flex-col gap-1 border-t border-app-border pt-2">
					<p className="text-[0.65rem] font-semibold tracking-wider text-app-text-muted uppercase">
						Projects
					</p>
					{previewProjects.map((project) => (
						<p key={project.id} className="truncate text-xs text-app-text">
							{project.name}
						</p>
					))}
					{remainingProjects > 0 && (
						<p className="text-xs text-app-text-muted">
							+{remainingProjects} more
						</p>
					)}
				</div>
			)}

			<Link
				to="/$orgSlug/people/$userId"
				params={{ orgSlug, userId }}
				className={cn(
					buttonVariants({ variant: "outline", size: "sm" }),
					"w-full",
				)}
			>
				View full profile
			</Link>
		</div>
	);
}
