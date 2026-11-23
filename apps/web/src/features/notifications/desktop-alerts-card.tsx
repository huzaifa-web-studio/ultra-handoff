"use client";

/**
 * Desktop alert settings card.
 *
 * Why a card and not a prompt on load: a notification permission shown without
 * context is usually declined forever. This explains what the alert is for and
 * asks only after a click, which is also the only moment browsers allow the
 * request.
 *
 * The browser permission and the local opt-in are shown separately because they
 * answer different questions: can this site notify, and does this person want
 * it to.
 *
 * Used by: routes/_app/$orgSlug.notifications.tsx.
 */

import { Button } from "@org/ui/components/button";
import { BellOffIcon, BellRingIcon } from "lucide-react";
import { useEffect, useState } from "react";

import {
	desktopPermission,
	hasDesktopOptIn,
	requestDesktopPermission,
	setDesktopOptIn,
} from "./desktop";
import { disablePush, enablePush, syncExistingPush } from "./push";

/** The detected IANA zone, for the reminder copy. */
function detectedTimezone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	} catch {
		return "UTC";
	}
}

export function DesktopAlertsCard() {
	const [permission, setPermission] = useState<
		NotificationPermission | "unsupported"
	>(() => desktopPermission());
	const [optedIn, setOptedIn] = useState(() => hasDesktopOptIn());
	const [pending, setPending] = useState(false);
	const timezone = detectedTimezone();

	useEffect(() => {
		const next = desktopPermission();
		const opted = hasDesktopOptIn();

		setPermission(next);
		setOptedIn(opted);

		// Repair a lost server row or a refreshed browser subscription after a
		// later sign in, without showing the permission prompt again.
		if (opted && next === "granted") {
			void syncExistingPush();
		}
	}, []);

	async function enable() {
		setPending(true);

		try {
			const next = await requestDesktopPermission();
			setPermission(next);

			if (next === "granted") {
				// First run the real push registration. If the deployment or the
				// browser cannot push, the page level alert still works while the
				// app is open.
				await enablePush().catch(() => undefined);
				setDesktopOptIn(true);
				setOptedIn(true);
			}
		} finally {
			setPending(false);
		}
	}

	function disable() {
		setDesktopOptIn(false);
		setOptedIn(false);
		void disablePush().catch(() => undefined);
	}

	const unsupported = permission === "unsupported";

	return (
		<section className="flex flex-col gap-3 border border-app-border bg-app-panel p-4">
			<div className="flex items-start justify-between gap-4">
				<div className="min-w-0">
					<h2 className="flex items-center gap-2 text-sm font-semibold text-app-text">
						<BellRingIcon className="size-4" aria-hidden />
						Desktop alerts
					</h2>
					<p className="mt-1 text-xs text-app-text-muted">
						Show an alert when Handoff is in the background. Reminders follow
						your local time, {timezone}.
					</p>
				</div>

				{unsupported ? (
					<span className="text-xs text-app-text-muted">Not supported</span>
				) : permission === "denied" ? (
					<span className="text-xs text-danger">Blocked by the browser</span>
				) : optedIn && permission === "granted" ? (
					<Button variant="outline" size="sm" onPress={disable}>
						<BellOffIcon aria-hidden />
						Turn off
					</Button>
				) : (
					<Button
						variant="outline"
						size="sm"
						isDisabled={pending}
						onPress={() => void enable()}
					>
						<BellRingIcon aria-hidden />
						{pending ? "Enabling..." : "Enable alerts"}
					</Button>
				)}
			</div>

			{unsupported ? (
				<p className="text-xs text-app-text-muted">
					This browser cannot show desktop alerts. In app notifications still
					work.
				</p>
			) : permission === "denied" ? (
				<p className="text-xs text-app-text-muted">
					Alerts are blocked for this site. Allow notifications in your browser
					site settings, then reload this page.
				</p>
			) : permission === "granted" && optedIn ? (
				<p className="text-xs text-app-text-muted">
					Desktop alerts are on for this browser. They are suppressed while you
					are looking at Handoff.
				</p>
			) : null}
		</section>
	);
}
