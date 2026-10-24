import { cn } from "cn";
import type * as React from "react";
import {
	composeRenderProps,
	Input as InputPrimitive,
} from "react-aria-components";

/**
 * The shared input look.
 *
 * Exported so a component that must render React Aria's `Input` directly inside
 * another primitive (a ComboBox, for example) can still match every other
 * input without duplicating the class list.
 */
export const inputClassName =
	"h-10 w-full min-w-0 border border-transparent border-b-input bg-transparent px-0 py-1 text-base transition-[color,border-color] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-b-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-b-destructive md:text-sm dark:aria-invalid:border-b-destructive/50";

function Input({
	className,
	type,
	...props
}: React.ComponentProps<typeof InputPrimitive>) {
	return (
		<InputPrimitive
			type={type}
			data-slot="input"
			className={composeRenderProps(className, (className) =>
				cn(inputClassName, className),
			)}
			{...props}
		/>
	);
}

export { Input };
