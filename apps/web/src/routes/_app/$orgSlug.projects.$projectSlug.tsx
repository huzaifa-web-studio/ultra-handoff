/**
 * Project workspace.
 *
 * Why this page exists: "Open project" needs a real destination, and the
 * sidebar is only useful if the rows it lists lead somewhere. This is the first
 * version of that destination: identity, status, description, the people on the
 * project, and the actions that already exist (pin, edit, manage members).
 *
 * Why it registers itself: opening a project from the table, from a direct URL
 * or from a refresh must all produce the same sidebar row. Doing it here means
 * there is one rule, and the table action only needs to navigate.
 *
 * Used by: the app sidebar project rows and the projects table "Open project".
 */

import { Badge } from "@org/ui/components/badge";
import { Button } from "@org/ui/components/button";
import { Skeleton } from "@org/ui/components/skeleton";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
	ArrowLeftIcon,
	PinIcon,
	PinOffIcon,
	RefreshCwIcon,
	Settings2Icon,
	UsersIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { setProjectBreadcrumbLabel } from "#/components/app-sidebar/project-breadcrumb";
import { UserAvatar } from "#/components/user-avatar";
import {
	useProjectDetailBySlug,
	useSetProjectPinned,
} from "#/features/projects/hooks";
import { ProjectDialog } from "#/features/projects/project-dialog";
import { ProjectMembersDialog } from "#/features/projects/project-members-dialog";
import { ProjectRoleChip } from "#/features/projects/project-role-chip";
import { ProjectStatusBadge } from "#/features/projects/project-status-badge";
import { formatDate, formatDateTime } from "#/lib/date";

export const Route = createFileRoute("/_app/$orgSlug/projects/$projectSlug")({
	component: ProjectPage,
	staticData: { breadcrumb: "Project" },
});

/** Members shown before the card points at the full list. */
const MEMBER_PREVIEW_MAX = 6;

function ProjectPage() {
	const { orgSlug, projectSlug } = Route.useParams();
	const navigate = useNavigate();

	const query = useProjectDetailBySlug(orgSlug, projectSlug);
	const { mutate: setPinned, isPending: isPinning } =
		useSetProjectPinned(orgSlug);

	const [editOpen, setEditOpen] = useState(false);
	const [membersOpen, setMembersOpen] = useState(false);

	const project = query.data?.project;

	// The header renders its breadcrumb from static route data, so the real
	// project name is published here while the page is mounted.
	useEffect(() => {
		setProjectBreadcrumbLabel(project?.name ?? null);

		return () => setProjectBreadcrumbLabel(null);
	}, [project?.name]);

	if (query.isPending) {
		return <ProjectSkeleton />;
	}

	if (query.isError && !query.data) {
		return (
			<div
				role="alert"
				className="mx-auto flex w-full max-w-3xl flex-col items-start gap-3 border border-danger bg-danger-bg p-4"
			>
				<p className="text-sm text-danger">
					{query.error instanceof Error
						? query.error.message
						: "Could not load the project."}
				</p>
				<div className="flex flex-wrap gap-2">
					<Button
						variant="surface"
						onPress={() => {
							void query.refetch();
						}}
					>
						<RefreshCwIcon aria-hidden />
						Try again
					</Button>
					<Button
						variant="outline"
						onPress={() =>
							navigate({ to: "/$orgSlug/projects", params: { orgSlug } })
						}
					>
						<ArrowLeftIcon aria-hidden />
						All projects
					</Button>
				</div>
			</div>
		);
	}

	if (!query.data || !project) return null;

	const { viewer, members, organizationId } = query.data;
	const archived = project.status === "archived";
	const previewMembers = members.slice(0, MEMBER_PREVIEW_MAX);

	function handleTogglePin() {
		if (!project) return;

		setPinned(
			{ projectId: project.id, pinned: !project.pinned },
			{
				onSuccess: () => {
					toast.success(
						project.pinned
							? "Removed from your sidebar."
							: "Pinned to your sidebar.",
					);
				},
				onError: (error) => {
					toast.error(
						error instanceof Error
							? error.message
							: "Could not update the pin.",
					);
				},
			},
		);
	}

	return (
		<div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
			<Link
				to="/$orgSlug/projects"
				params={{ orgSlug }}
				className="inline-flex w-fit items-center gap-1.5 text-sm text-app-text-muted hover:text-app-text"
			>
				<ArrowLeftIcon className="size-4" aria-hidden />
				All projects
			</Link>

			<header className="flex flex-col gap-4 border-b border-app-border pb-6">
				<div className="flex flex-wrap items-start justify-between gap-4">
					<div className="flex min-w-0 items-start gap-3">
						<UserAvatar
							size="lg"
							shape="square"
							name={project.name}
							src={project.logo}
						/>
						<div className="flex min-w-0 flex-col gap-1.5">
							<div className="flex flex-wrap items-center gap-2">
								<h1 className="text-2xl font-bold text-app-text">
									{project.name}
								</h1>
								<ProjectStatusBadge status={project.status} />
								<ProjectRoleChip role={project.myRole} />
							</div>
							<p className="text-sm text-app-text-muted">/{project.slug}</p>
							{project.description ? (
								<p className="max-w-2xl text-app-text-muted">
									{project.description}
								</p>
							) : (
								<p className="max-w-2xl text-sm text-app-text-muted">
									No description yet.
								</p>
							)}
						</div>
					</div>

					<div className="flex flex-wrap items-center gap-2">
						<Button
							variant="outline"
							isDisabled={isPinning || (archived && !project.pinned)}
							onPress={handleTogglePin}
						>
							{project.pinned ? (
								<PinOffIcon aria-hidden />
							) : (
								<PinIcon aria-hidden />
							)}
							{project.pinned ? "Unpin" : "Pin"}
						</Button>
						{viewer.canEdit && (
							<Button variant="outline" onPress={() => setEditOpen(true)}>
								<Settings2Icon aria-hidden />
								Edit project
							</Button>
						)}
						{viewer.canManageMembers && (
							<Button variant="outline" onPress={() => setMembersOpen(true)}>
								<UsersIcon aria-hidden />
								Manage members
							</Button>
						)}
					</div>
				</div>

				{archived && (
					<p className="text-sm text-app-text-muted">
						This project is archived. It stays readable, but it cannot be pinned
						until it is restored from the projects list.
					</p>
				)}
			</header>

			<div className="grid gap-4 sm:grid-cols-3">
				<InfoStat label="Created" value={formatDate(project.createdAt)} />
				<InfoStat
					label="Last updated"
					value={formatDate(project.updatedAt)}
					title={formatDateTime(project.updatedAt)}
				/>
				<InfoStat
					label="Members"
					value={String(members.length)}
					title={`${members.length} ${members.length === 1 ? "person" : "people"}`}
				/>
			</div>

			<section className="flex flex-col border border-app-border bg-app-panel">
				<div className="flex flex-wrap items-center justify-between gap-2 border-b border-app-border p-4">
					<div className="flex items-center gap-2">
						<h2 className="text-sm font-semibold text-app-text">Members</h2>
						<Badge className="bg-neutral-bg text-neutral">
							{members.length}
						</Badge>
					</div>
					{viewer.canManageMembers && (
						<Button variant="ghost" onPress={() => setMembersOpen(true)}>
							Manage
						</Button>
					)}
				</div>

				{previewMembers.length === 0 ? (
					<p className="p-4 text-sm text-app-text-muted">
						Nobody has been added to this project yet.
					</p>
				) : (
					<ul className="divide-y divide-app-border">
						{previewMembers.map((member) => (
							<li
								key={member.userId}
								className="flex flex-wrap items-center justify-between gap-3 p-3"
							>
								<div className="flex min-w-0 items-center gap-2.5">
									<UserAvatar size="sm" name={member.name} src={member.image} />
									<div className="flex min-w-0 flex-col">
										<span className="truncate text-sm font-medium text-app-text">
											{member.name}
											{member.isSelf && (
												<span className="text-app-text-muted"> (you)</span>
											)}
										</span>
										<span className="truncate text-xs text-app-text-muted">
											{member.email}
										</span>
									</div>
								</div>
								<ProjectRoleChip role={member.role} />
							</li>
						))}
					</ul>
				)}

				{members.length > previewMembers.length && (
					<div className="border-t border-app-border p-3">
						<Button variant="ghost" onPress={() => setMembersOpen(true)}>
							Show all {members.length} members
						</Button>
					</div>
				)}
			</section>

			{/*
			 * Mounted only while open, like the create dialog. That clears the
			 * form and the logo uploader's local preview between sessions.
			 */}
			{editOpen && (
				<ProjectDialog
					orgSlug={orgSlug}
					organizationId={organizationId}
					mode="edit"
					project={project}
					isOpen={editOpen}
					onOpenChange={setEditOpen}
					onUpdated={(updated) => {
						// The URL is the slug, so a rename must move the page with
						// it. Replacing the entry keeps the back button clean.
						if (updated.project.slug === projectSlug) return;

						navigate({
							to: "/$orgSlug/projects/$projectSlug",
							params: { orgSlug, projectSlug: updated.project.slug },
							replace: true,
						});
					}}
				/>
			)}

			<ProjectMembersDialog
				orgSlug={orgSlug}
				project={project}
				isOpen={membersOpen}
				onOpenChange={setMembersOpen}
			/>
		</div>
	);
}

/** One small fact about the project. */
function InfoStat({
	label,
	value,
	title,
}: {
	label: string;
	value: string;
	title?: string;
}) {
	return (
		<div className="flex flex-col gap-1 border border-app-border bg-app-panel p-3">
			<span className="text-xs font-semibold tracking-widest text-app-text-muted uppercase">
				{label}
			</span>
			<span className="text-sm font-medium text-app-text" title={title}>
				{value}
			</span>
		</div>
	);
}

/** Loading shape that matches the real page, so it does not jump. */
function ProjectSkeleton() {
	return (
		<div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
			<Skeleton className="h-4 w-28" />
			<div className="flex items-start gap-3 border-b border-app-border pb-6">
				<Skeleton className="size-12" />
				<div className="flex flex-col gap-2">
					<Skeleton className="h-8 w-56" />
					<Skeleton className="h-4 w-32" />
					<Skeleton className="h-4 w-96" />
				</div>
			</div>
			<div className="grid gap-4 sm:grid-cols-3">
				<Skeleton className="h-20 w-full" />
				<Skeleton className="h-20 w-full" />
				<Skeleton className="h-20 w-full" />
			</div>
			<Skeleton className="h-64 w-full" />
		</div>
	);
}
