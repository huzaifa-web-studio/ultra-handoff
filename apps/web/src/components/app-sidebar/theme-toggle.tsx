"use client";

/**
 * Theme switch for the app header.
 *
 * Why a dropdown rather than a two state button: a button can only toggle
 * between light and dark, and would silently drop the "follow my system"
 * choice that a first time visitor starts on. The menu keeps all three
 * preferences reachable and shows which one is active.
 *
 * The trigger renders only after mount because next-themes has no answer for
 * `theme` during the first render, and drawing an icon for an unresolved value
 * would flip once hydration finishes.
 *
 * Used by: apps/web/src/components/app-sidebar/app-header.tsx.
 */

import { Button } from "@org/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@org/ui/components/dropdown-menu";
import { useTheme } from "@org/ui/components/theme-provider";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useEffect, useState } from "react";

/** The three preferences, in the order the menu lists them. */
const THEME_OPTIONS = [
	{ value: "light", label: "Light", Icon: SunIcon },
	{ value: "dark", label: "Dark", Icon: MoonIcon },
	{ value: "system", label: "System", Icon: MonitorIcon },
] as const;

type ThemeOption = (typeof THEME_OPTIONS)[number]["value"];

/** Icons by preference, so the trigger can show the active one. */
const THEME_ICONS = {
	light: SunIcon,
	dark: MoonIcon,
	system: MonitorIcon,
} as const;

function isThemeOption(value: unknown): value is ThemeOption {
	return value === "light" || value === "dark" || value === "system";
}

export function ThemeToggle() {
	const { theme, setTheme } = useTheme();
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		setMounted(true);
	}, []);

	/*
	 * An unresolved or unexpected value is shown as "system", which is also the
	 * default the provider applies for a first time visitor.
	 */
	const active: ThemeOption =
		mounted && isThemeOption(theme) ? theme : "system";
	const ActiveIcon = THEME_ICONS[active];

	return (
		<DropdownMenuTrigger>
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label={`Change theme, currently ${active}`}
			>
				<ActiveIcon aria-hidden />
			</Button>
			<DropdownMenu
				placement="bottom end"
				selectionMode="single"
				selectedKeys={new Set<ThemeOption>([active])}
				onSelectionChange={(keys) => {
					// Single select mode always yields at most one key.
					if (keys === "all") return;
					const [next] = Array.from(keys);
					if (isThemeOption(next)) setTheme(next);
				}}
			>
				{THEME_OPTIONS.map(({ value, label, Icon }) => (
					<DropdownMenuItem key={value} id={value} textValue={label}>
						<Icon aria-hidden />
						{label}
					</DropdownMenuItem>
				))}
			</DropdownMenu>
		</DropdownMenuTrigger>
	);
}
