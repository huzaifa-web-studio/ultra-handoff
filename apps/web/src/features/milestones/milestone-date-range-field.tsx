"use client";

/**
 * Start and due date field.
 *
 * Why one range picker instead of two date inputs: a milestone has a start and
 * an end, and picking them one by one makes it easy to create an inverted range.
 * The range calendar cannot produce one, and the API and the database check the
 * same rule for direct API calls.
 *
 * The two ends are still independent columns. This control edits the pair,
 * which keeps the model honest: a milestone with no schedule has neither date,
 * and the trigger says so.
 *
 * Used by: milestone-detail-panel.tsx.
 */

import {
	type CalendarDate,
	type DateValue,
	parseDate,
} from "@internationalized/date";
import { Button } from "@org/ui/components/button";
import { RangeCalendar } from "@org/ui/components/calendar";
import { Popover, PopoverTrigger } from "@org/ui/components/popover";
import { CalendarIcon } from "lucide-react";
import type { RangeValue } from "react-aria-components";

import { describeDateRange, normalizeDay } from "./schema";

/**
 * Parse a stored day into a calendar value, or null when it is invalid.
 *
 * `normalizeDay` accepts a full ISO timestamp as well as a day, so a cached
 * response with a time component still selects the right day instead of
 * throwing.
 */
function parseDay(value: string | null): CalendarDate | null {
	const day = normalizeDay(value);
	if (!day) return null;

	try {
		return parseDate(day);
	} catch {
		// A value that cannot be parsed is treated as "no date" rather than
		// blocking the field forever.
		return null;
	}
}

export function MilestoneDateRangeField({
	startDate,
	dueDate,
	onChange,
	readOnly = false,
}: {
	startDate: string | null;
	dueDate: string | null;
	onChange: (next: {
		startDate: string | null;
		dueDate: string | null;
	}) => void;
	readOnly?: boolean;
}) {
	const start = parseDay(startDate);
	const due = parseDay(dueDate);

	// A range needs both ends. A row that only has one still displays correctly
	// through the trigger text, and the next pick sets both.
	const value: RangeValue<DateValue> | null =
		start && due ? { start, end: due } : null;

	if (readOnly) {
		return (
			<span className="text-sm text-app-text">
				{describeDateRange(startDate, dueDate)}
			</span>
		);
	}

	return (
		<PopoverTrigger>
			<Button
				variant="outline"
				size="sm"
				className="w-full justify-start font-normal normal-case tracking-normal"
			>
				<CalendarIcon aria-hidden />
				<span className="truncate">
					{describeDateRange(startDate, dueDate)}
				</span>
			</Button>
			<Popover className="w-auto p-0">
				<RangeCalendar
					aria-label="Milestone dates"
					value={value}
					onChange={(next) => {
						if (!next) {
							onChange({ startDate: null, dueDate: null });
							return;
						}

						// Store day strings, never the calendar's own value objects.
						// The parent owns the saved state, so it must not depend on a
						// date library type.
						onChange({
							startDate: normalizeDay(next.start),
							dueDate: normalizeDay(next.end),
						});
					}}
					captionLayout="dropdown"
					numberOfMonths={1}
				/>
				<div className="flex items-center justify-between border-t border-app-border p-2">
					<span className="px-2 text-xs text-app-text-muted">
						Select a start and an end
					</span>
					<Button
						size="xs"
						variant="ghost"
						onPress={() => onChange({ startDate: null, dueDate: null })}
					>
						Clear dates
					</Button>
				</div>
			</Popover>
		</PopoverTrigger>
	);
}
