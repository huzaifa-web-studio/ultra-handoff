/**
 * Project members toolbar.
 *
 * Why a component: search, the role filter, the count and the batch actions sit
 * above the table and share its state. Keeping them together leaves the page
 * focused on data.
 *
 * Used by: project-members-page.tsx.
 */

import { Button } from "@org/ui/components/button";
import { Input } from "@org/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@org/ui/components/select";
import { SearchIcon, Trash2Icon, UserPlusIcon } from "lucide-react";

import {
	PROJECT_ROLE_LABELS,
	PROJECT_ROLES,
	type ProjectRole,
} from "../permissions";

export function ProjectMembersToolbar({
	search,
	onSearchChange,
	roleFilter,
	onRoleFilterChange,
	total,
	visibleCount,
	selectedCount,
	canManage,
	onAdd,
	onRemoveSelected,
}: {
	search: string;
	onSearchChange: (value: string) => void;
	roleFilter: "all" | ProjectRole;
	onRoleFilterChange: (value: "all" | ProjectRole) => void;
	total: number;
	visibleCount: number;
	selectedCount: number;
	canManage: boolean;
	onAdd: () => void;
	onRemoveSelected: () => void;
}) {
	return (
		<div className="flex flex-wrap items-center gap-3">
			<div className="relative min-w-56 flex-1">
				<SearchIcon
					className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-app-text-muted"
					aria-hidden
				/>
				<Input
					type="search"
					value={search}
					onChange={(event) => onSearchChange(event.target.value)}
					placeholder="Search name or email"
					aria-label="Search project members"
					className="pl-9"
				/>
			</div>

			<Select
				aria-label="Filter members by role"
				selectedKey={roleFilter}
				onSelectionChange={(key) => {
					const value = String(key);
					onRoleFilterChange(value === "all" ? "all" : (value as ProjectRole));
				}}
				className="w-40"
			>
				<SelectTrigger size="sm" className="w-full">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem id="all">All roles</SelectItem>
					{PROJECT_ROLES.map((role) => (
						<SelectItem key={role} id={role}>
							{PROJECT_ROLE_LABELS[role]}
						</SelectItem>
					))}
				</SelectContent>
			</Select>

			<p className="text-sm text-app-text-muted">
				{visibleCount === total
					? `${total} ${total === 1 ? "person" : "people"}`
					: `${visibleCount} of ${total}`}
			</p>

			<div className="flex flex-wrap items-center gap-2">
				{selectedCount > 0 && (
					<Button variant="destructive" onPress={onRemoveSelected}>
						<Trash2Icon aria-hidden />
						Remove {selectedCount}
					</Button>
				)}
				{canManage && (
					<Button onPress={onAdd}>
						<UserPlusIcon data-icon="inline-start" />
						Add members
					</Button>
				)}
			</div>
		</div>
	);
}
