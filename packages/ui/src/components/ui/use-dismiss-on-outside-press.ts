/**
 * Outside press dismissal for non-modal react-aria popovers.
 *
 * Why this exists: react-aria only wires outside interaction dismissal when a
 * popover is modal (`isDismissable: !isNonModal` inside usePopover). A modal
 * popover renders a full screen underlay, so the first outside click closes the
 * popover and is swallowed instead of reaching the element underneath. A
 * non-modal popover lets the click through but never closes on pointer down, so
 * it can only close on Escape, on selection, or when focus leaves the popover.
 *
 * This hook adds the missing behaviour: while the popover is open, a press
 * outside both the popover and its trigger closes it without preventing or
 * stopping the event, so the pressed control still performs its action on the
 * same click.
 *
 * Used by: dropdown-menu.tsx and select.tsx.
 */

import { type RefObject, useContext, useEffect } from "react";
import {
	OverlayTriggerStateContext,
	PopoverContext,
	useSlottedContext,
} from "react-aria-components";

/**
 * Presses inside react-aria's top layer (toasts, for example) are not treated
 * as "outside". Same rule the library applies in useInteractOutside.
 */
const TOP_LAYER_SELECTOR = "[data-react-aria-top-layer]";

export function useDismissOnOutsidePress(
	popoverRef: RefObject<HTMLElement | null>,
): void {
	const state = useContext(OverlayTriggerStateContext);
	// The trigger element is published by MenuTrigger, Select, MenuTrigger
	// submenus and so on. It is needed so the trigger's own toggle keeps
	// working: closing on pointer down and reopening on click would make the
	// popover look stuck open.
	const triggerRef = useSlottedContext(PopoverContext)?.triggerRef;
	const isOpen = state?.isOpen ?? false;

	useEffect(() => {
		if (!isOpen) return;

		const handlePointerDown = (event: PointerEvent) => {
			// Only the primary button counts as the interaction that dismisses.
			if (event.button > 0) return;

			const target = event.target;
			if (target instanceof Element && target.closest(TOP_LAYER_SELECTOR)) {
				return;
			}

			// composedPath follows the real event path across portals, where the
			// popover is not a DOM ancestor of the pressed element.
			const path = event.composedPath();
			const popover = popoverRef.current;
			const trigger = triggerRef?.current;

			if (popover && path.includes(popover)) return;
			if (trigger && path.includes(trigger)) return;

			// No preventDefault and no stopPropagation here. The press has to
			// keep travelling to the underlying control so its action runs on
			// the same click that dismissed the popover.
			state?.close();
		};

		document.addEventListener("pointerdown", handlePointerDown, true);

		return () =>
			document.removeEventListener("pointerdown", handlePointerDown, true);
	}, [isOpen, popoverRef, triggerRef, state]);
}
