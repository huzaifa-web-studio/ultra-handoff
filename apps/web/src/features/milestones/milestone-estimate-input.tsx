"use client";

/**
 * Time estimate input with type-ahead suggestions.
 *
 * Why a combobox instead of a native datalist: a datalist popup is drawn by the
 * browser, outside the page, so it cannot be styled from `global.css` and never
 * matches this design system. React Aria's ComboBox keeps the same behaviour
 * (filter while typing, arrow keys, Enter, Escape) while the list is ordinary
 * markup controlled by tokens.
 *
 * The text field is React Aria's own `Input`, not the app wrapper. A ComboBox
 * wires its input through context and a ref, and going through an extra
 * component broke that wiring, which made the field impossible to type in.
 * The shared `inputClassName` keeps the look identical to every other input.
 *
 * The field stays free text (`allowsCustomValue`), so any accepted format can
 * still be typed; the suggestions are teaching aids, not a closed list.
 *
 * Used by: milestone-estimate-field.tsx, milestone-create-dialog.tsx.
 */

import { inputClassName } from "@org/ui/components/input";
import { cn } from "cn";
import {
	ComboBox,
	Input,
	ListBox,
	ListBoxItem,
	Popover,
} from "react-aria-components";

/** Formats offered as suggestions. The value is exactly what the parser gets. */
const ESTIMATE_SUGGESTIONS = [
	"2h",
	"1h 30m",
	"1d",
	"1d 4h",
	"1d 1h 1m 1s",
	"90m",
];

export function MilestoneEstimateInput({
	value,
	onChange,
	onFocus,
	onBlur,
	invalid = false,
	placeholder = "1h 30m",
}: {
	value: string;
	onChange: (value: string) => void;
	onFocus?: () => void;
	onBlur?: () => void;
	invalid?: boolean;
	placeholder?: string;
}) {
	return (
		<ComboBox<string>
			aria-label="Time estimate"
			className="w-full"
			allowsCustomValue
			items={ESTIMATE_SUGGESTIONS}
			inputValue={value}
			onInputChange={onChange}
			onSelectionChange={(key) => {
				// Selecting an option already updates the input in most cases.
				// Writing it again is harmless and makes the behaviour explicit.
				if (key != null) onChange(String(key));
			}}
		>
			<Input
				placeholder={placeholder}
				aria-invalid={invalid || undefined}
				onFocus={onFocus}
				onBlur={onBlur}
				className={cn(inputClassName, "h-9 w-full text-sm")}
			/>
			<Popover className="z-50 w-(--trigger-width) overflow-hidden border border-app-border bg-popover text-popover-foreground shadow-md data-entering:animate-in data-entering:fade-in-0 data-exiting:animate-out data-exiting:fade-out-0">
				<ListBox className="max-h-56 overflow-y-auto p-1 outline-none">
					{(item: string) => (
						<ListBoxItem
							id={item}
							textValue={item}
							className="cursor-pointer px-2 py-1.5 text-sm text-app-text outline-none data-focused:bg-app-selected data-hovered:bg-app-panel-subtle"
						>
							{item}
						</ListBoxItem>
					)}
				</ListBox>
			</Popover>
		</ComboBox>
	);
}
