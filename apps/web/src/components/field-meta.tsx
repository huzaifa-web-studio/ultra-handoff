/**
 * Footer block for a form field: a short hint on the left, an optional
 * character count on the right.
 *
 * Why: a hint used to be one long sentence that mixed the rule, the current
 * usage and an unrelated warning, which made it hard to tell where one fact
 * ended. This keeps each fact on its own line, aligns the count in its own
 * column, and leaves the maximum in exactly one place. The old copy printed
 * the max twice, once as "3 to 48 characters" and again as "12/48".
 *
 * Used by: project, organization, account and auth forms.
 */

import { FieldDescription } from "@org/ui/components/field";
import { cn } from "cn";
import type * as React from "react";

type FieldMetaProps = {
	/**
	 * One fact per child. A plain string is one fact. Pass several children to
	 * stack them on separate lines.
	 */
	children: React.ReactNode;
	/** Omit for fields without a hard maximum. */
	counter?: { current: number; max: number };
};

export function FieldMeta({ children, counter }: FieldMetaProps) {
	return (
		<div className="flex items-start justify-between gap-4">
			<FieldDescription className="min-w-0 [&>span+span]:mt-1 [&>span]:block">
				{children}
			</FieldDescription>
			{counter && <CharacterCount {...counter} />}
		</div>
	);
}

/**
 * The visible count stays compact ("12/48"). The full wording is only for
 * screen readers, so the number has context without repeating the hint.
 */
function CharacterCount({ current, max }: { current: number; max: number }) {
	const over = current > max;
	const near = !over && current >= max * 0.9;

	return (
		<span
			className={cn(
				"shrink-0 pt-0.5 text-xs tabular-nums text-app-text-muted",
				near && "text-warning",
				over && "text-danger",
			)}
		>
			<span aria-hidden="true">
				{current}/{max}
			</span>
			<span className="sr-only">
				{current} of {max} characters
			</span>
		</span>
	);
}
