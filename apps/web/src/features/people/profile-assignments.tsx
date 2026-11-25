/**
 * Open milestones assigned to the profile owner.
 *
 * Why a card beside the projects list: this is the "what are they working on"
 * answer a teammate actually looks for. Only live statuses are returned by the
 * API, so the card does not need to filter or explain finished work.
 *
 * Used by: features/people/profile-page.tsx.
 */

import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@org/ui/components/card";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { CalendarIcon, ListTodoIcon } from "lucide-react";

import { MilestoneStatusBadge } from "#/features/milestones/milestone-status-badge";
import {
	describeDueDate,
	isMilestoneOverdue,
} from "#/features/milestones/schema";
import type { MemberProfileAssignment } from "./api";

export function ProfileAssignments({
	orgSlug,
	assignments,
}: {
	orgSlug: string;
	assignments: MemberProfileAssignment[];
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					Assigned work
					<span className="text-sm font-normal text-app-text-muted">
						{assignments.length}
					</span>
				</CardTitle>
			</CardHeader>

			<CardContent>
				{assignments.length === 0 ? (
					<div className="flex flex-col items-center gap-2 py-6 text-center">
						<ListTodoIcon aria-hidden className="size-6 text-app-text-muted" />
						<p className="text-sm text-app-text-muted">
							No open work assigned.
						</p>
					</div>
				) : (
					<ul className="flex flex-col divide-y divide-app-border">
						{assignments.map((assignment) => {
							const overdue = isMilestoneOverdue(
								assignment.dueDate,
								assignment.status,
							);

							return (
								<li key={assignment.id}>
									<Link
										to="/$orgSlug/projects/$projectSlug/milestones"
										params={{
											orgSlug,
											projectSlug: assignment.projectSlug,
										}}
										search={{ milestone: assignment.id }}
										className="flex flex-col gap-1.5 py-3 hover:bg-app-panel-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-focus"
									>
										<div className="flex items-start justify-between gap-3">
											<div className="min-w-0">
												<p className="truncate text-sm font-medium text-app-text">
													{assignment.title}
												</p>
												<p className="truncate text-xs text-app-text-muted">
													{assignment.projectName}
												</p>
											</div>
											<MilestoneStatusBadge status={assignment.status} />
										</div>

										<p
											className={cn(
												"inline-flex items-center gap-1.5 text-xs",
												overdue ? "text-danger" : "text-app-text-muted",
											)}
										>
											<CalendarIcon aria-hidden className="size-3" />
											{describeDueDate(assignment.dueDate, assignment.status)}
										</p>
									</Link>
								</li>
							);
						})}
					</ul>
				)}
			</CardContent>
		</Card>
	);
}
