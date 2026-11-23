/**
 * Browser level notification helpers.
 *
 * Why a small module: the permission state, the local opt-in and the "is the
 * user away" check are used by the realtime provider and by the settings card.
 * Keeping them together means the card and the delivery path cannot disagree
 * about whether alerts are on.
 *
 * The local flag is separate from the browser permission on purpose. A granted
 * permission is not consent to be interrupted, so the person still has to turn
 * alerts on. The flag is per browser, like the permission itself.
 *
 * Used by: features/notifications/realtime.tsx and the notifications page.
 */

export const DESKTOP_OPT_IN_KEY = "handoff:notifications:desktop";

/** True when the runtime can show a page level notification. */
export function supportsDesktopNotifications(): boolean {
	return (
		typeof window !== "undefined" &&
		"Notification" in window &&
		window.isSecureContext
	);
}

/** The current browser permission, or unsupported. */
export function desktopPermission(): NotificationPermission | "unsupported" {
	if (!supportsDesktopNotifications()) return "unsupported";

	return Notification.permission;
}

/** Read the local opt-in flag. */
export function hasDesktopOptIn(): boolean {
	if (typeof window === "undefined") return false;

	try {
		return window.localStorage.getItem(DESKTOP_OPT_IN_KEY) === "on";
	} catch {
		return false;
	}
}

/** Persist the local opt-in flag. */
export function setDesktopOptIn(enabled: boolean): void {
	if (typeof window === "undefined") return;

	try {
		if (enabled) {
			window.localStorage.setItem(DESKTOP_OPT_IN_KEY, "on");
		} else {
			window.localStorage.removeItem(DESKTOP_OPT_IN_KEY);
		}
	} catch {
		// Storage can be unavailable in private mode. The browser permission
		// still governs whether an alert can be shown.
	}
}

/** Ask the browser for permission. Must be called from a user gesture. */
export async function requestDesktopPermission(): Promise<
	NotificationPermission | "unsupported"
> {
	if (!supportsDesktopNotifications()) return "unsupported";

	return Notification.requestPermission();
}

/**
 * True when the person is not looking at this app.
 *
 * A hidden tab and an unfocused window both count. A visible, focused tab shows
 * the in-app toast and badge instead, so an operating system alert would be a
 * duplicate.
 */
export function isAwayFromApp(): boolean {
	if (typeof document === "undefined") return false;

	return document.visibilityState === "hidden" || !document.hasFocus();
}

/** Show one page level notification. */
export function showDesktopNotification(input: {
	title: string;
	body: string;
	href: string;
	tag: string;
}): void {
	if (!supportsDesktopNotifications()) return;
	if (Notification.permission !== "granted") return;

	try {
		const notification = new Notification(input.title, {
			body: input.body,
			tag: input.tag,
			icon: "/favicon.svg",
			data: { href: input.href },
		});

		notification.onclick = () => {
			window.focus();
			window.location.assign(input.href);
			notification.close();
		};
	} catch {
		// Some browsers expose the constructor but refuse it outside a service
		// worker context. The in-app bell still shows the notification.
	}
}
