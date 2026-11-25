/**
 * Member profile page.
 *
 * Why a composition instead of one large file: the header owns actions and the
 * two lists are independent reads of the same response. Keeping them in small
 * components makes each one reviewable and keeps this file about states
 * (loading, missing, failed, ready) rather than markup.
 *
 * Used by: routes/_app/$orgSlug.people.$userId.tsx.
 */

import { Button, buttonVariants } from "@org/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@org/ui/components/card";
import { Skeleton } from "@org/ui/components/skeleton";
import { Link } from "@tanstack/react-router";
import { useEffect } from "react";

import { setDynamicBreadcrumbLabel } from "#/components/app-sidebar/dynamic-breadcrumb";
import { ApiRequestError } from "#/lib/api";
import { useMemberProfile } from "./hooks";
import { ProfileAssignments } from "./profile-assignments";
import { ProfileHeader } from "./profile-header";
import { ProfileProjects } from "./profile-projects";

export function ProfilePage({
	orgSlug,
	userId,
}: {
	orgSlug: string;
	userId: string;
}) {
	const query = useMemberProfile(orgSlug, userId);
	const name = query.data?.name;

	// Publish the person's name for the header crumb, then clear it on unmount
	// so the next page cannot inherit it.
	useEffect(() => {
		if (!name) return;

		setDynamicBreadcrumbLabel("Profile", name);

		return () => setDynamicBreadcrumbLabel("Profile", null);
	}, [name]);

	if (query.isPending) return <ProfilePageSkeleton />;

	if (query.isError) {
		const missing =
			query.error instanceof ApiRequestError && query.error.status === 404;

		return (
			<div className="mx-auto w-full max-w-5xl">
				<Card>
					<CardHeader>
						<CardTitle>
							{missing ? "Profile not found" : "Could not load this profile"}
						</CardTitle>
						<CardDescription>
							{missing
								? "This person is no longer part of the workspace."
								: query.error.message}
						</CardDescription>
					</CardHeader>
					<CardContent className="flex flex-wrap gap-2">
						{!missing && (
							<Button variant="outline" onPress={() => void query.refetch()}>
								Try again
							</Button>
						)}
						<Link
							to="/$orgSlug/settings/members"
							params={{ orgSlug }}
							className={buttonVariants({ variant: "outline" })}
						>
							Back to members
						</Link>
					</CardContent>
				</Card>
			</div>
		);
	}

	const profile = query.data;

	return (
		<div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
			<ProfileHeader profile={profile} />

			{/*
			 * The bio is plain text from the person. `whitespace-pre-line` keeps
			 * the paragraph breaks they typed without rendering any markup.
			 */}
			{profile.bio && (
				<Card>
					<CardHeader>
						<CardTitle>About</CardTitle>
					</CardHeader>
					<CardContent>
						<p className="text-sm leading-relaxed whitespace-pre-line text-app-text">
							{profile.bio}
						</p>
					</CardContent>
				</Card>
			)}

			<div className="grid gap-6 lg:grid-cols-2">
				<ProfileProjects orgSlug={orgSlug} projects={profile.projects} />
				<ProfileAssignments
					orgSlug={orgSlug}
					assignments={profile.assignments}
					hasMore={profile.hasMoreAssignments}
				/>
			</div>
		</div>
	);
}

/** Loading shape that matches the real page, so the layout does not jump. */
function ProfilePageSkeleton() {
	return (
		<div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
			<div className="flex flex-col gap-5 border border-app-border bg-app-panel p-5 sm:flex-row sm:p-6">
				<Skeleton className="mx-auto size-20 shrink-0 sm:mx-0" />
				<div className="flex flex-1 flex-col gap-3">
					<Skeleton className="h-8 w-56" />
					<Skeleton className="h-4 w-40" />
					<Skeleton className="h-4 w-72" />
				</div>
			</div>

			<Skeleton className="h-32 w-full" />

			<div className="grid gap-6 lg:grid-cols-2">
				<Skeleton className="h-64 w-full" />
				<Skeleton className="h-64 w-full" />
			</div>
		</div>
	);
}
