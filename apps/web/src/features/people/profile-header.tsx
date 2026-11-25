/**
 * The identity block at the top of a profile.
 *
 * Why a component: the header carries the only copy action and the self link on
 * the page, so keeping it separate from the lists makes the page component a
 * thin composition and keeps the file small.
 *
 * Used by: features/people/profile-page.tsx.
 */

import { Badge } from "@org/ui/components/badge";
import { Button, buttonVariants } from "@org/ui/components/button";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import {
	CalendarIcon,
	CopyIcon,
	MailIcon,
	MapPinIcon,
	PencilIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { RoleChip } from "#/components/role-chip";
import { UserAvatar } from "#/components/user-avatar";
import { formatDate } from "#/lib/date";
import type { MemberProfile } from "./api";

/** Copy an address without claiming success when the clipboard is denied. */
async function copyEmail(email: string) {
	try {
		await navigator.clipboard.writeText(email);
		toast.success("Email address copied.");
	} catch {
		toast.error("Could not copy the email address.");
	}
}

/** One compact fact with a leading icon. */
function Fact({
	icon: Icon,
	children,
}: {
	icon: typeof CalendarIcon;
	children: ReactNode;
}) {
	return (
		<span className="inline-flex items-center gap-1.5">
			<Icon aria-hidden className="size-3.5 shrink-0" />
			{children}
		</span>
	);
}

export function ProfileHeader({ profile }: { profile: MemberProfile }) {
	return (
		<header className="flex flex-col gap-5 border border-app-border bg-app-panel p-5 sm:flex-row sm:items-start sm:p-6">
			<UserAvatar
				size="xl"
				src={profile.image}
				name={profile.name}
				className="mx-auto sm:mx-0"
			/>

			<div className="flex min-w-0 flex-1 flex-col gap-3">
				<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
					<div className="min-w-0">
						<div className="flex flex-wrap items-center gap-2">
							<h1 className="truncate text-2xl font-bold text-app-text">
								{profile.name}
							</h1>
							<RoleChip role={profile.role} />
							{profile.isSelf && (
								<Badge className="bg-app-selected text-app-text">You</Badge>
							)}
						</div>

						{profile.jobTitle && (
							<p className="mt-1 text-sm font-medium text-app-text-muted">
								{profile.jobTitle}
							</p>
						)}
					</div>

					{profile.isSelf && (
						<Link
							to="/account"
							className={cn(
								buttonVariants({ variant: "outline", size: "sm" }),
								"shrink-0 self-start",
							)}
						>
							<PencilIcon aria-hidden />
							Edit profile
						</Link>
					)}
				</div>

				<div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-app-text-muted">
					<Fact icon={CalendarIcon}>
						Member since {formatDate(profile.joinedAt)}
					</Fact>

					{profile.location && (
						<Fact icon={MapPinIcon}>{profile.location}</Fact>
					)}

					<Fact icon={MailIcon}>
						<span className="break-all">{profile.email}</span>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={`Copy ${profile.name}'s email address`}
							onPress={() => void copyEmail(profile.email)}
						>
							<CopyIcon aria-hidden />
						</Button>
					</Fact>
				</div>
			</div>
		</header>
	);
}
