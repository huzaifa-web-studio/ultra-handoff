import {
	DropdownMenu,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@org/ui/components/dropdown-menu";
import {
	SidebarGroup,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuAction,
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebar,
} from "@org/ui/components/sidebar";
import {
	ArrowRightIcon,
	FolderIcon,
	MoreHorizontalIcon,
	Trash2Icon,
} from "lucide-react";
import type * as React from "react";

export function NavProjects({
	projects,
}: {
	projects: {
		name: string;
		url: string;
		icon: React.ReactNode;
	}[];
}) {
	const { isMobile } = useSidebar();
	return (
		<SidebarGroup className="group-data-[collapsible=icon]:hidden">
			<SidebarGroupLabel>Projects</SidebarGroupLabel>
			<SidebarMenu>
				{projects.map((item) => (
					<SidebarMenuItem key={item.name}>
						<SidebarMenuButton href={item.url}>
							{item.icon}
							<span>{item.name}</span>
						</SidebarMenuButton>

						<DropdownMenuTrigger>
							<SidebarMenuAction showOnHover className="aria-expanded:bg-muted">
								<MoreHorizontalIcon />
								<span className="sr-only">More</span>
							</SidebarMenuAction>
							<DropdownMenu
								className="w-fit"
								placement={isMobile ? "bottom end" : "right top"}
							>
								<DropdownMenuItem>
									<FolderIcon />
									<span>View Project</span>
								</DropdownMenuItem>
								<DropdownMenuItem>
									<ArrowRightIcon />
									<span>Share Project</span>
								</DropdownMenuItem>
								<DropdownMenuSeparator />
								<DropdownMenuItem variant="destructive">
									<Trash2Icon />
									<span>Delete Project</span>
								</DropdownMenuItem>
							</DropdownMenu>
						</DropdownMenuTrigger>
					</SidebarMenuItem>
				))}
				<SidebarMenuItem>
					<SidebarMenuButton className="text-sidebar-foreground/70">
						<MoreHorizontalIcon className="text-sidebar-foreground/70" />
						<span>More</span>
					</SidebarMenuButton>
				</SidebarMenuItem>
			</SidebarMenu>
		</SidebarGroup>
	);
}
