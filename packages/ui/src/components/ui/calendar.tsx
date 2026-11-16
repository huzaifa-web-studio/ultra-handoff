"use client";

/**
 * Calendar in the aria-sera style.
 *
 * Why: milestone dates are picked as a range, and a range needs a real
 * two-ended picker rather than two unrelated single date inputs. This is the
 * shadcn aria-sera calendar (React Aria), adapted to this project's tokens.
 *
 * The registry version imports a docs-only icon placeholder and registry
 * aliases, which do not exist here, so the icons are imported from lucide and
 * the imports are relative. The markup and behaviour otherwise match the
 * registry so a future update stays a small diff.
 *
 * Used by: features/milestones/milestone-date-range-field.tsx through the
 * popover date picker.
 */

import { cva } from "class-variance-authority";
import { cn } from "cn";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import type * as React from "react";
import {
	Calendar as AriaCalendar,
	CalendarGridHeader as AriaCalendarGridHeader,
	RangeCalendar as AriaRangeCalendar,
	CalendarCell,
	type CalendarCellRenderProps,
	CalendarGrid,
	CalendarGridBody,
	CalendarHeaderCell,
	CalendarHeading,
	CalendarMonthPicker,
	type CalendarProps,
	CalendarYearPicker,
	type DateValue,
	type RangeCalendarProps,
} from "react-aria-components";

import { Button, buttonVariants } from "./button";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "./select";

/**
 * Cell states.
 *
 * The range band is drawn by the cell wrapper while the day itself is a button
 * sized by `buttonVariants`, which is what keeps selection and focus states
 * visually consistent with every other control in the app.
 */
const cellVariants = cva(
	"group/day relative mt-2 aspect-square h-full w-full cursor-default rounded-(--cell-radius) p-0 text-center select-none [&:is(:last-child>[data-selected=true])>div]:rounded-r-(--cell-radius)",
	{
		variants: {
			showWeekNumber: {
				false:
					"[&:is(:first-child>[data-selected=true])>div]:rounded-l-(--cell-radius)",
				true: "[&:is(:nth-child(2)>[data-selected=true])>div]:rounded-l-(--cell-radius)",
			},
			isToday: {
				true: "rounded-(--cell-radius) bg-app-panel-subtle text-app-text data-[selected=true]:rounded-none",
			},
			isSelectionStart: {
				true: "relative isolate z-0 rounded-l-(--cell-radius) bg-app-selected after:absolute after:inset-y-0 after:right-0 after:w-4 after:bg-app-selected",
			},
			isSelectionEnd: {
				true: "relative isolate z-0 rounded-r-(--cell-radius) bg-app-selected after:absolute after:inset-y-0 after:left-0 after:w-4 after:bg-app-selected",
			},
			isUnavailable: {
				true: "text-app-text-muted opacity-50 [&>div]:line-through",
			},
			isDisabled: {
				true: "text-app-text-muted opacity-50",
			},
			isOutsideMonth: {
				true: "text-app-text-muted aria-selected:text-app-text-muted",
			},
		},
	},
);

/** Props shared by the single and range calendars. */
type CalendarShellProps = {
	buttonVariant?: React.ComponentProps<typeof Button>["variant"];
	captionLayout?: "label" | "dropdown";
	numberOfMonths?: number;
	showWeekNumber?: boolean;
	headerFormat?: Intl.DateTimeFormatOptions;
	/**
	 * Number of years the year dropdown lists. Defaults to the react-aria
	 * value of 20. Pass a value that matches the allowed min and max dates so
	 * the dropdown does not offer years outside them.
	 */
	visibleYears?: number;
	renderCell?: (
		renderProps: CalendarCellRenderProps & {
			defaultChildren: React.ReactNode;
		},
	) => React.ReactNode;
};

/**
 * A pair of days to draw as a range on a single date calendar.
 *
 * Why this exists: the milestone picks a start and a due date separately, so
 * the calendar edits one day at a time. Without this, switching which end is
 * being edited moved the only highlight to that end and the other end vanished,
 * which read as the whole calendar jumping. The pair lets the calendar show
 * both ends and the span between them while the selection stays single.
 */
type CalendarRangeHighlight = {
	start: DateValue | null;
	end: DateValue | null;
};

/**
 * Where one day sits inside the highlighted pair.
 *
 * A partial pair marks only the end that exists. Only a complete pair paints a
 * band, so a lone date never grows a tinted halo around its cell.
 */
function rangePosition(day: DateValue, range?: CalendarRangeHighlight) {
	const start = range?.start ?? null;
	const end = range?.end ?? null;
	// A pair only forms a band when it is ordered. The field already keeps the
	// ends ordered, and a start equal to the due date is a single day, not a
	// one day span, so neither case should paint a band around the cell.
	const ordered = start !== null && end !== null && start.compare(end) < 0;

	return {
		isStart: start !== null && day.compare(start) === 0,
		isEnd: end !== null && day.compare(end) === 0,
		isMiddle: ordered && day.compare(start) > 0 && day.compare(end) < 0,
		pairComplete: ordered,
	};
}

/** Single date calendar. */
function Calendar<
	T extends DateValue,
	M extends "single" | "multiple" = "single",
>(
	props: Omit<CalendarProps<T, M>, "visibleDuration"> &
		CalendarShellProps & {
			rangeHighlight?: CalendarRangeHighlight;
		},
) {
	const { rangeHighlight, ...calendarProps } = props;

	return (
		<AriaCalendar
			{...calendarProps}
			data-slot="calendar"
			visibleDuration={{ months: props.numberOfMonths || 1 }}
			className={cn(
				"group/calendar w-fit bg-app-panel p-3 [--cell-radius:0] [--cell-size:--spacing(8)]",
				props.className,
			)}
		>
			<CalendarInner {...props} />
		</AriaCalendar>
	);
}

/** Range calendar, used for the start and due date field. */
function RangeCalendar<T extends DateValue>(
	props: RangeCalendarProps<T> & CalendarShellProps,
) {
	return (
		<AriaRangeCalendar
			{...props}
			data-slot="calendar"
			visibleDuration={{ months: props.numberOfMonths || 1 }}
			className={cn(
				"group/calendar w-fit bg-app-panel p-3 [--cell-radius:0] [--cell-size:--spacing(8)]",
				props.className,
			)}
		>
			<CalendarInner {...props} isRange />
		</AriaRangeCalendar>
	);
}

/** The shared header, grid and cell rendering for both calendars. */
function CalendarInner({
	captionLayout = "label",
	buttonVariant = "ghost",
	numberOfMonths = 1,
	showWeekNumber = false,
	headerFormat,
	visibleYears,
	renderCell,
	rangeHighlight,
	isRange,
}: CalendarShellProps & {
	isRange?: boolean;
	rangeHighlight?: CalendarRangeHighlight;
}) {
	// Only an ordered pair paints a band. A single end stays a lone filled
	// square, so the highlighted cell never grows a tinted halo around it.
	const bandVisible =
		!isRange &&
		rangeHighlight?.start != null &&
		rangeHighlight.end != null &&
		rangeHighlight.start.compare(rangeHighlight.end) < 0;

	return (
		<div className="relative flex flex-col gap-4 md:flex-row">
			<header className="absolute inset-x-0 top-0 flex w-full items-center justify-between gap-1">
				<Button
					variant={buttonVariant}
					size="icon-sm"
					slot="previous"
					className="p-0 select-none aria-disabled:opacity-50"
				>
					<ChevronLeftIcon className="cn-rtl-flip size-4" aria-hidden />
				</Button>
				<Button
					variant={buttonVariant}
					size="icon-sm"
					slot="next"
					className="p-0 select-none aria-disabled:opacity-50"
				>
					<ChevronRightIcon className="cn-rtl-flip size-4" aria-hidden />
				</Button>
			</header>
			{Array.from({ length: numberOfMonths }, (_, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: months are a fixed ordered range
				<div key={index} className="flex w-full flex-col gap-4">
					<div className="flex h-(--cell-size) w-full items-center justify-center gap-1 px-(--cell-size)">
						{captionLayout === "dropdown" ? (
							<>
								<MonthDropdown format={headerFormat} />
								<YearDropdown visibleYears={visibleYears} />
							</>
						) : (
							<CalendarHeading
								offset={{ months: index }}
								format={headerFormat}
								className="text-sm font-medium tracking-wide text-app-text uppercase select-none"
							/>
						)}
					</div>
					<CalendarGrid
						className={cn(
							"w-full border-collapse",
							// Paint the whole table cell for the days of the pair, not just
							// the day button. The button carries a top margin, so painting
							// only the button leaves a gap between the rows and the span
							// reads as separate bars instead of one range. The cell fills
							// the row, so its background closes that gap.
							bandVisible &&
								"[&_td:has(>div[data-range-start=true])]:bg-app-selected [&_td:has(>div[data-range-middle=true])]:bg-app-selected [&_td:has(>div[data-range-end=true])]:bg-app-selected",
						)}
						offset={{ months: index }}
					>
						<AriaCalendarGridHeader>
							{(day) => (
								<CalendarHeaderCell className="rounded-(--cell-radius) text-[0.8rem] font-normal text-app-text-muted select-none">
									{day}
								</CalendarHeaderCell>
							)}
						</AriaCalendarGridHeader>
						<CalendarGridBody>
							{(date) => {
								// A single date calendar edits one end, so the pair it should
								// draw comes from the caller. A range calendar already knows
								// its own selection and does not need it.
								const position = isRange
									? null
									: rangePosition(date, rangeHighlight);
								// A day inside the pair keeps the band as its background, so
								// the today tint must not cover the band with a second tone.
								const inPair = Boolean(
									position?.pairComplete &&
										(position.isStart || position.isEnd || position.isMiddle),
								);

								return (
									<CalendarCell
										date={date}
										className={(renderProps) =>
											cellVariants({
												...renderProps,
												showWeekNumber,
												isToday: renderProps.isToday && !inPair,
											})
										}
									>
										{(renderProps) => (
											<div
												data-selected-single={
													renderProps.isSelected && !isRange
												}
												data-range-start={
													isRange
														? renderProps.isSelectionStart
														: position?.isStart
												}
												data-range-end={
													isRange ? renderProps.isSelectionEnd : position?.isEnd
												}
												data-range-middle={
													isRange
														? renderProps.isSelected &&
															!renderProps.isSelectionStart &&
															!renderProps.isSelectionEnd
														: position?.isMiddle
												}
												className={cn(
													buttonVariants({ variant: "ghost", size: "icon-sm" }),
													"relative isolate z-10 flex aspect-square h-full w-full min-w-(--cell-size) flex-col gap-1 border-0 leading-none font-normal",
													"group-data-[focused=true]/day:relative group-data-[focused=true]/day:z-10 group-data-[focused=true]/day:border-app-focus group-data-[focused=true]/day:ring-[3px] group-data-[focused=true]/day:ring-app-focus/30",
													"data-[range-end=true]:rounded-(--cell-radius) data-[range-end=true]:bg-primary data-[range-end=true]:text-primary-foreground",
													"data-[range-middle=true]:rounded-none data-[range-middle=true]:bg-app-selected data-[range-middle=true]:text-app-text",
													"data-[range-start=true]:rounded-(--cell-radius) data-[range-start=true]:bg-primary data-[range-start=true]:text-primary-foreground",
													"data-[selected-single=true]:bg-primary data-[selected-single=true]:text-primary-foreground",
													"[&>span]:text-xs [&>span]:opacity-70",
												)}
											>
												{renderCell
													? renderCell(renderProps)
													: renderProps.defaultChildren}
											</div>
										)}
									</CalendarCell>
								);
							}}
						</CalendarGridBody>
					</CalendarGrid>
				</div>
			))}
		</div>
	);
}

/** Month selector used when `captionLayout="dropdown"`. */
function MonthDropdown({ format }: { format?: Intl.DateTimeFormatOptions }) {
	return (
		<CalendarMonthPicker format={format?.month}>
			{(props) => (
				<Select {...props} aria-label="Month" className="relative">
					<SelectTrigger>
						<SelectValue />
					</SelectTrigger>
					<SelectContent className="min-w-0">
						<SelectGroup>
							{props.items.map((item) => (
								<SelectItem key={item.id} id={item.id}>
									{item.formatted}
								</SelectItem>
							))}
						</SelectGroup>
					</SelectContent>
				</Select>
			)}
		</CalendarMonthPicker>
	);
}

/** Year selector used when `captionLayout="dropdown"`. */
function YearDropdown({ visibleYears }: { visibleYears?: number }) {
	return (
		<CalendarYearPicker visibleYears={visibleYears}>
			{(props) => (
				<Select {...props} aria-label="Year" className="relative">
					<SelectTrigger>
						<SelectValue />
					</SelectTrigger>
					<SelectContent className="min-w-0">
						{props.items.map((item) => (
							<SelectItem key={item.id} id={item.id}>
								{item.formatted}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			)}
		</CalendarYearPicker>
	);
}

export { Calendar, RangeCalendar };
