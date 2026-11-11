"use client";

/**
 * Theme provider for the whole app.
 *
 * Why next-themes and why it lives in this package: it owns the three things a
 * theme switch has to get right on its own, persisting the choice, following
 * the operating system when the choice is "system", and applying the class
 * before the first paint so a saved dark theme never flashes light. It is
 * already a dependency here because `sonner` reads `useTheme`, and apps cannot
 * resolve it directly under Bun's isolated linker.
 *
 * `attribute="class"` matches the `.dark` variant declared in global.css, and
 * `disableTransitionOnChange` stops every hover transition in the app from
 * animating at once while the class flips.
 *
 * Used by: apps/web/src/routes/__root.tsx (mounted once for the document) and
 * apps/web/src/components/app-sidebar/theme-toggle.tsx (reads and sets it).
 */

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type * as React from "react";

function ThemeProvider({ children }: { children: React.ReactNode }) {
	return (
		<NextThemesProvider
			attribute="class"
			defaultTheme="system"
			enableSystem
			disableTransitionOnChange
			storageKey="handoff:theme"
		>
			{children}
		</NextThemesProvider>
	);
}

export { ThemeProvider };
/*
 * Re-exported so consumers do not import next-themes directly, which would add
 * a dependency to the app that only the component library owns.
 */
export { useTheme } from "next-themes";
