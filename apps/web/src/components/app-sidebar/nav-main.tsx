"use client";

import {
	Collapsible,
	CollapsibleContent,
} from "@org/ui/components/collapsible";
import {
	SidebarGroup,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSub,
	SidebarMenuSubButton,
	SidebarMenuSubItem,
} from "@org/ui/components/sidebar";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { ChevronRightIcon } from "lucide-react";
import type * as React from "react";
import { useEffect, useState } from "react";

const SIDEBAR_EXPANDED_KEY = "handoff:sidebar:expanded";

export function NavMain({
	items,
}: {
	items: {
		title: string;
		url: string;
		icon?: React.ReactNode;
		isActive?: boolean;
		items?: {
			title: string;
			url: string;
		}[];
	}[];
}) {
	const navigate = useNavigate();
	const { pathname } = useLocation();

	// Persist which collapsible groups are open so a reload keeps the sidebar
	// exactly as the user left it.
	const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
		if (typeof window === "undefined") return {};
		try {
			const raw = window.localStorage.getItem(SIDEBAR_EXPANDED_KEY);
			return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
		} catch {
			return {};
		}
	});

	useEffect(() => {
		try {
			window.localStorage.setItem(
				SIDEBAR_EXPANDED_KEY,
				JSON.stringify(expanded),
			);
		} catch {
			// Storage may be unavailable (private mode); ignore.
		}
	}, [expanded]);

	return (
		<SidebarGroup>
			<SidebarGroupLabel>Platform</SidebarGroupLabel>
			<SidebarMenu>
				{items.map((item) =>
					item.items && item.items.length > 0 ? (
						<Collapsible
							key={item.title}
							isExpanded={expanded[item.title] ?? item.isActive ?? false}
							onExpandedChange={(open) =>
								setExpanded((prev) => ({ ...prev, [item.title]: open }))
							}
							className="group/collapsible"
							render={(props) => <SidebarMenuItem {...props} />}
						>
							<SidebarMenuButton
								slot="trigger"
								tooltip={item.title}
								isActive={
									pathname === item.url || pathname.startsWith(`${item.url}/`)
								}
							>
								{item.icon}
								<span>{item.title}</span>
								<ChevronRightIcon className="ml-auto transition-transform duration-200 group-data-expanded/collapsible:rotate-90" />
							</SidebarMenuButton>
							<CollapsibleContent>
								<SidebarMenuSub>
									{item.items.map((subItem) => (
										<SidebarMenuSubItem key={subItem.title}>
											<SidebarMenuSubButton
												href={subItem.url}
												isActive={pathname === subItem.url}
												onClick={(e: React.MouseEvent) => {
													e.preventDefault();
													navigate({ to: subItem.url });
												}}
											>
												<span>{subItem.title}</span>
											</SidebarMenuSubButton>
										</SidebarMenuSubItem>
									))}
								</SidebarMenuSub>
							</CollapsibleContent>
						</Collapsible>
					) : (
						<SidebarMenuItem key={item.title}>
							<SidebarMenuButton
								href={item.url}
								isActive={pathname === item.url}
								onClick={(e: React.MouseEvent) => {
									e.preventDefault();
									navigate({ to: item.url });
								}}
								tooltip={item.title}
							>
								{item.icon}
								<span>{item.title}</span>
							</SidebarMenuButton>
						</SidebarMenuItem>
					),
				)}
			</SidebarMenu>
		</SidebarGroup>
	);
}
