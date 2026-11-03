"use client";

/**
 * Start and due date picker for a milestone.
 *
 * Why two independent rows and one calendar: a milestone has a start and a
 * due date that are edited separately (schedule the start before the deadline
 * is known, and the other way around). A range calendar forces both ends to be
 * picked in one gesture and cannot represent "start only", which the database
 * and the API already allow.
 *
 * The calendar always edits whichever row is active. Opening the picker makes
 * the due date active, which matches the common flow: pick the deadline first,
 * then add a start date if the milestone needs one. Clicking or tabbing into a
 * row moves the calendar to that row.
 *
 * Both ends stay day strings (`YYYY-MM-DD`). The picker never produces a time
 * because the columns are `date`, and keeping the value as a calendar day
 * avoids a timezone shift on save.
 *
 * An inverted range is resolved at the point of entry: picking a start after
 * the due date moves the due date with it, and picking a due before the start
 * moves the start. The database check and the API validator therefore stay
 * satisfied without an error the user has to fix by hand.
 *
 * Used by: milestone-detail-panel.tsx, milestone-create-dialog.tsx.
 */

import {
	CalendarDate,
	type DateValue,
	endOfMonth,
	getLocalTimeZone,
	parseDate,
	today,
} from "@internationalized/date";
import { Button } from "@org/ui/components/button";
import { Calendar } from "@org/ui/components/calendar";
import { Popover, PopoverTrigger } from "@org/ui/components/popover";
import { cn } from "cn";
import { CalendarIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { DateField, DateInput, DateSegment } from "react-aria-components";

import { describeDateRange, normalizeDay } from "./schema";

/** Which end of the schedule the calendar edits. */
type DateEnd = "start" | "due";

/** The date pair a change reports back to the parent. */
type DateRange = {
	startDate: string | null;
	dueDate: string | null;
};

/** One quick pick offered next to the calendar. */
type QuickPick = {
	label: string;
	day: CalendarDate;
};

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

/**
 * Narrow any calendar value to a plain day.
 *
 * React Aria hands back `DateValue`, which can also carry a time or a zone.
 * The field only edits days, so rebuilding a `CalendarDate` is what keeps a
 * timestamp from leaking into a `date` column.
 */
function toCalendarDay(value: DateValue | null): CalendarDate | null {
	if (!value) return null;

	return new CalendarDate(value.year, value.month, value.day);
}

/** Store a calendar day as the `YYYY-MM-DD` string the API expects. */
function toDayString(value: CalendarDate | null): string | null {
	return value ? value.toString() : null;
}

/**
 * The quick picks shown to the left of the calendar.
 *
 * "Next Monday" skips today when today is already Monday, so the shortcut
 * always moves forward. "This weekend" is the coming Saturday.
 */
function buildQuickPicks(): QuickPick[] {
	const now = today(getLocalTimeZone());

	// 0 is Sunday and 6 is Saturday. Reading the weekday in UTC avoids the
	// local timezone shifting the day around midnight.
	const weekday = new Date(
		Date.UTC(now.year, now.month - 1, now.day),
	).getUTCDay();
	// Sunday is already the weekend, so it stays. Any other day moves to the
	// coming Saturday.
	const untilSaturday = weekday === 0 ? 0 : (6 - weekday + 7) % 7;
	// Monday is 1. Zero means today is already Monday, so jump a full week.
	const untilMonday = (1 - weekday + 7) % 7 || 7;

	return [
		{ label: "Today", day: now },
		{ label: "Tomorrow", day: now.add({ days: 1 }) },
		{ label: "This weekend", day: now.add({ days: untilSaturday }) },
		{ label: "Next Monday", day: now.add({ days: untilMonday }) },
		{ label: "Next week", day: now.add({ days: 7 }) },
		{ label: "End of month", day: endOfMonth(now) },
	];
}

/**
 * One editable end of the schedule.
 *
 * The visible label is a plain span because it sits in a dense row, and the
 * `aria-label` on the field is the accessible name the screen reader announces
 * when focus enters the date segments.
 */
function EndRow({
	label,
	value,
	active,
	autoFocus = false,
	onActivate,
	onChange,
	onClear,
}: {
	label: string;
	value: CalendarDate | null;
	active: boolean;
	autoFocus?: boolean;
	onActivate: () => void;
	onChange: (value: CalendarDate | null) => void;
	onClear: () => void;
}) {
	return (
		<div
			onFocusCapture={onActivate}
			onPointerDownCapture={onActivate}
			className={cn(
				"flex items-center gap-2 border px-2 py-1.5 transition-colors",
				active
					? "border-app-focus bg-app-selected"
					: "border-app-border bg-app-panel",
			)}
		>
			<span className="w-16 shrink-0 text-[0.6rem] font-semibold tracking-widest text-app-text-muted uppercase">
				{label}
			</span>

			<DateField
				aria-label={label}
				value={value}
				onChange={(next) => onChange(toCalendarDay(next))}
				granularity="day"
				autoFocus={autoFocus}
				className="flex min-w-0 flex-1 items-center"
			>
				<DateInput className="flex w-full items-center gap-0.5 text-sm text-app-text">
					{(segment) => (
						<DateSegment
							segment={segment}
							className="px-0.5 py-0.5 outline-none data-[focused]:bg-app-focus data-[focused]:text-app-action-text data-[placeholder]:text-app-text-muted data-[type=literal]:px-0"
						/>
					)}
				</DateInput>
			</DateField>

			{active && (
				<span className="shrink-0 text-[0.6rem] font-semibold tracking-widest text-app-focus uppercase">
					Editing
				</span>
			)}

			<Button
				variant="ghost"
				size="icon-xs"
				aria-label={`Clear ${label.toLowerCase()}`}
				onPress={onClear}
				className={cn(!value && "invisible")}
			>
				<XIcon aria-hidden />
			</Button>
		</div>
	);
}

export function MilestoneDateRangeField({
	startDate,
	dueDate,
	onChange,
	readOnly = false,
}: {
	startDate: string | null;
	dueDate: string | null;
	onChange: (next: DateRange) => void;
	readOnly?: boolean;
}) {
	const start = parseDay(startDate);
	const due = parseDay(dueDate);

	const [open, setOpen] = useState(false);
	// The common flow is "set the deadline first", so the due date starts
	// active. A row that is clicked or focused takes over immediately.
	const [active, setActive] = useState<DateEnd>("due");

	const activeValue = active === "start" ? start : due;

	/**
	 * Apply one picked day to one end and keep the pair ordered.
	 *
	 * When the picked day crosses the other end, the other end moves with it
	 * instead of the pick being rejected. Clearing an end leaves the other end
	 * untouched, which is the whole point of editing them separately.
	 */
	function applyDay(end: DateEnd, day: CalendarDate | null) {
		let nextStart = end === "start" ? day : start;
		let nextDue = end === "due" ? day : due;

		if (nextStart && nextDue && nextStart.compare(nextDue) > 0) {
			if (end === "start") {
				nextDue = nextStart;
			} else {
				nextStart = nextDue;
			}
		}

		onChange({
			startDate: toDayString(nextStart),
			dueDate: toDayString(nextDue),
		});
	}

	if (readOnly) {
		return (
			<span className="text-sm text-app-text">
				{describeDateRange(startDate, dueDate)}
			</span>
		);
	}

	return (
		<PopoverTrigger isOpen={open} onOpenChange={setOpen}>
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
				<div className="flex max-h-[calc(100svh-4rem)] w-[min(34rem,calc(100vw-2rem))] flex-col overflow-y-auto">
					{/* The two ends, each independently editable and clearable. */}
					<div className="flex flex-col gap-2 border-b border-app-border p-3">
						<EndRow
							label="Start date"
							value={start}
							active={active === "start"}
							onActivate={() => setActive("start")}
							onChange={(next) => applyDay("start", next)}
							onClear={() => applyDay("start", null)}
						/>
						<EndRow
							label="Due date"
							value={due}
							active={active === "due"}
							autoFocus
							onActivate={() => setActive("due")}
							onChange={(next) => applyDay("due", next)}
							onClear={() => applyDay("due", null)}
						/>
					</div>

					<div className="flex flex-col sm:flex-row">
						{/* Quick picks fill the active end, not the whole range. */}
						<div className="flex shrink-0 flex-row flex-wrap gap-1 border-b border-app-border p-2 sm:w-40 sm:flex-col sm:flex-nowrap sm:border-r sm:border-b-0">
							{buildQuickPicks().map((pick) => (
								<Button
									key={pick.label}
									variant="ghost"
									size="sm"
									className="justify-start px-2 font-normal normal-case tracking-normal"
									onPress={() => applyDay(active, pick.day)}
								>
									{pick.label}
								</Button>
							))}
						</div>

						<div className="min-w-0 flex-1 p-3">
							<Calendar
								aria-label={
									active === "start"
										? "Start date calendar"
										: "Due date calendar"
								}
								value={activeValue}
								onChange={(next) => applyDay(active, toCalendarDay(next))}
								captionLayout="dropdown"
								numberOfMonths={1}
								className="w-full bg-transparent p-0"
							/>
						</div>
					</div>

					<div className="flex items-center justify-between gap-2 border-t border-app-border p-2">
						<Button
							size="xs"
							variant="ghost"
							className="font-normal normal-case tracking-normal"
							isDisabled={!start && !due}
							onPress={() => onChange({ startDate: null, dueDate: null })}
						>
							Clear dates
						</Button>
						<Button
							size="xs"
							variant="surface"
							className="font-normal normal-case tracking-normal"
							onPress={() => setOpen(false)}
						>
							Done
						</Button>
					</div>
				</div>
			</Popover>
		</PopoverTrigger>
	);
}
