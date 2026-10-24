"use client";

/**
 * Milestone assignees field.
 *
 * Why the shared multi select: a project can have many members, and a plain
 * list of checkboxes neither scales nor searches. The multi select already
 * handles search, keyboard navigation, the selected badges and the empty state,
 * and it is the same control the project member picker uses.
 *
 * The selection saves as a complete set on every change. The API replaces the
 * set, so two quick changes cannot interleave into a half applied state.
 *
 * Used by: milestone-detail-panel.tsx.
 */

import {
	MultiSelect,
	type MultiSelectOption,
} from "@org/ui/components/multi-select";

import { UserAvatar } from "#/components/user-avatar";
import type { MilestoneAssignee } from "./api";

/**
 * The part of a project member this field needs.
 *
 * Deliberately structural instead of importing the projects feature type: a
 * milestone only cares that the person has an id, a label and an optional
 * avatar. The project member row satisfies it without a cross feature import.
 */
export type AssignableMember = {
	userId: string;
	name: string;
	email: string;
	image: string | null;
};

export function MilestoneAssigneeField({
	members,
	selected,
	assignees,
	onChange,
	readOnly = false,
}: {
	members: AssignableMember[];
	/** The selected user ids, including an in flight local change. */
	selected: string[];
	/** The saved assignees, used for the read only display. */
	assignees: MilestoneAssignee[];
	onChange: (userIds: string[]) => void;
	readOnly?: boolean;
}) {
	if (readOnly) {
		return (
			<span className="text-sm text-app-text">
				{assignees.length === 0
					? "Unassigned"
					: assignees.map((assignee) => assignee.name).join(", ")}
			</span>
		);
	}

	const options: MultiSelectOption[] = members.map((member) => ({
		value: member.userId,
		label: member.name,
		description: member.email,
		leading: <UserAvatar size="sm" name={member.name} src={member.image} />,
	}));

	return (
		<MultiSelect
			label="Assignees"
			options={options}
			selected={selected}
			onSelectedChange={onChange}
			placeholder="Unassigned"
			searchPlaceholder="Search people"
			emptyMessage="Nobody on this project matches that search."
			className="min-h-9 py-1.5"
		/>
	);
}
