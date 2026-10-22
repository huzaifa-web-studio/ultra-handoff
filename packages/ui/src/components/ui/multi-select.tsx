"use client";

/**
 * Multi select built on the shadcn Command primitives.
 *
 * Why this shape: a plain list of checkboxes does not scale to a long member
 * list and gives no keyboard search. This combines the Command input with a
 * multiple selection menu, so typing filters the options, arrow keys move,
 * Enter toggles and Escape closes. The trigger summarises the selection as
 * badges, and the footer keeps Select all and Clear one click away.
 *
 * Used by: the project members dialog for adding several people at once.
 */

import { cn } from "cn";
import { ChevronsUpDownIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { Selection } from "react-aria-components";

import { Badge } from "./badge";
import { Button } from "./button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "./command";
import { Popover, PopoverTrigger } from "./popover";

/** One row in the picker. `value` is what gets selected and submitted. */
export type MultiSelectOption = {
	value: string;
	label: string;
	/** Secondary line, usually an email address or a role. */
	description?: string;
	/** Optional leading node, such as an avatar. */
	leading?: ReactNode;
};

type MultiSelectProps = {
	options: MultiSelectOption[];
	selected: string[];
	onSelectedChange: (next: string[]) => void;
	/** Accessible name for the trigger and the option list. */
	label: string;
	placeholder?: string;
	searchPlaceholder?: string;
	emptyMessage?: string;
	disabled?: boolean;
	className?: string;
};

/** How many badges the closed trigger shows before it collapses to a count. */
const VISIBLE_BADGES = 2;

const BADGE_CLASS =
	"max-w-40 border border-app-border bg-app-panel-subtle text-xs font-medium tracking-normal text-app-text normal-case";

export function MultiSelect({
	options,
	selected,
	onSelectedChange,
	label,
	placeholder = "Select options",
	searchPlaceholder = "Search...",
	emptyMessage = "No results.",
	disabled = false,
	className,
}: MultiSelectProps) {
	const selectedSet = new Set(selected);
	const selectedOptions = options.filter((option) =>
		selectedSet.has(option.value),
	);
	const visibleBadges = selectedOptions.slice(0, VISIBLE_BADGES);
	const hiddenCount = selectedOptions.length - visibleBadges.length;

	function handleSelectionChange(keys: Selection) {
		if (keys === "all") {
			onSelectedChange(options.map((option) => option.value));
			return;
		}

		onSelectedChange(Array.from(keys).map(String));
	}

	return (
		<PopoverTrigger>
			<Button
				variant="outline"
				isDisabled={disabled}
				aria-label={
					selectedOptions.length === 0
						? label
						: `${label}, ${selectedOptions.length} selected`
				}
				className={cn(
					"h-auto min-h-10 w-full justify-between gap-2 px-3 py-2 text-left font-normal tracking-normal normal-case",
					className,
				)}
			>
				<span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
					{selectedOptions.length === 0 ? (
						<span className="text-sm text-muted-foreground">{placeholder}</span>
					) : (
						<>
							{visibleBadges.map((option) => (
								<Badge
									key={option.value}
									variant="secondary"
									className={BADGE_CLASS}
								>
									<span className="truncate">{option.label}</span>
								</Badge>
							))}
							{hiddenCount > 0 && (
								<Badge variant="secondary" className={BADGE_CLASS}>
									+{hiddenCount}
								</Badge>
							)}
						</>
					)}
				</span>
				<ChevronsUpDownIcon
					className="size-4 shrink-0 opacity-50"
					aria-hidden
				/>
			</Button>

			{/*
			 * Match the menu to the trigger so a long list never spills past the
			 * field it belongs to. `--trigger-width` is set by react-aria.
			 */}
			<Popover
				placement="bottom start"
				className="w-(--trigger-width) min-w-72 gap-0 p-0"
			>
				<Command>
					<CommandInput placeholder={searchPlaceholder} />
					<CommandList
						aria-label={label}
						selectionMode="multiple"
						selectedKeys={selectedSet}
						onSelectionChange={handleSelectionChange}
						renderEmptyState={() => <CommandEmpty>{emptyMessage}</CommandEmpty>}
					>
						<CommandGroup>
							{options.map((option) => (
								<CommandItem
									key={option.value}
									id={option.value}
									textValue={`${option.label} ${option.description ?? ""}`}
									className="gap-2 data-selected:bg-app-selected"
								>
									{option.leading}
									<span className="flex min-w-0 flex-1 flex-col">
										<span className="truncate text-sm font-medium text-app-text">
											{option.label}
										</span>
										{option.description && (
											<span className="truncate text-xs text-app-text-muted">
												{option.description}
											</span>
										)}
									</span>
								</CommandItem>
							))}
						</CommandGroup>
					</CommandList>

					<div className="flex items-center justify-between gap-2 border-t border-app-border px-2 py-1.5">
						<span aria-live="polite" className="text-xs text-app-text-muted">
							{selectedOptions.length} selected
						</span>
						<div className="flex items-center gap-1">
							<Button
								size="xs"
								variant="outline"
								isDisabled={disabled || options.length === 0}
								onPress={() =>
									onSelectedChange(options.map((option) => option.value))
								}
							>
								Select all
							</Button>
							<Button
								size="xs"
								variant="ghost"
								isDisabled={selectedOptions.length === 0}
								onPress={() => onSelectedChange([])}
							>
								Clear
							</Button>
						</div>
					</div>
				</Command>
			</Popover>
		</PopoverTrigger>
	);
}
