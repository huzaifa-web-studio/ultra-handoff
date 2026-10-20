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
import { ChevronRightIcon } from "lucide-react";
import type * as React from "react";

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
	return (
		<SidebarGroup>
			<SidebarGroupLabel>Platform</SidebarGroupLabel>
			<SidebarMenu>
				{items.map((item) => (
					<Collapsible
						key={item.title}
						defaultExpanded={item.isActive}
						className="group/collapsible"
						render={(props) => <SidebarMenuItem {...props} />}
					>
						<SidebarMenuButton slot="trigger" tooltip={item.title}>
							{item.icon}
							<span>{item.title}</span>
							<ChevronRightIcon className="ml-auto transition-transform duration-200 group-data-expanded/collapsible:rotate-90" />
						</SidebarMenuButton>
						<CollapsibleContent>
							<SidebarMenuSub>
								{item.items?.map((subItem) => (
									<SidebarMenuSubItem key={subItem.title}>
										<SidebarMenuSubButton href={subItem.url}>
											<span>{subItem.title}</span>
										</SidebarMenuSubButton>
									</SidebarMenuSubItem>
								))}
							</SidebarMenuSub>
						</CollapsibleContent>
					</Collapsible>
				))}
			</SidebarMenu>
		</SidebarGroup>
	);
}
