"use client";

import { cn } from "cn";
import {
	type ButtonProps,
	DisclosurePanel as CollapsibleContentPrimitive,
	Disclosure as CollapsiblePrimitive,
	Button as CollapsibleTriggerPrimitive,
	type DisclosurePanelProps,
	type DisclosureProps,
} from "react-aria-components";

function Collapsible({ ...props }: DisclosureProps) {
	return <CollapsiblePrimitive data-slot="collapsible" {...props} />;
}

function CollapsibleTrigger({ className, ...props }: ButtonProps) {
	return (
		<CollapsibleTriggerPrimitive
			slot="trigger"
			data-slot="collapsible-trigger"
			className={cn("cursor-pointer!", className)}
			{...props}
		/>
	);
}

function CollapsibleContent({ ...props }: DisclosurePanelProps) {
	return (
		<CollapsibleContentPrimitive data-slot="collapsible-content" {...props} />
	);
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
