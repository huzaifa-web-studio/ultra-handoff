import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarRail,
} from "@org/ui/components/sidebar";
import { useNavigate } from "@tanstack/react-router";
import {
	AudioLinesIcon,
	GalleryVerticalEndIcon,
	LayoutDashboardIcon,
	Settings2Icon,
	TerminalIcon,
} from "lucide-react";
import type * as React from "react";
import { NavMain } from "./nav-main";
import { NavUser } from "./nav-user";
import { OrganizationSwitcher } from "./organization-switcher";

export function AppSidebar({
	user,
	onSignOut,
	...props
}: React.ComponentProps<typeof Sidebar> & {
	user?: {
		name: string;
		email: string;
		avatar: string;
	};
	onSignOut?: () => void | Promise<void>;
}) {
	const navigate = useNavigate();
	return (
		<Sidebar collapsible="icon" {...props}>
			<SidebarHeader>
				<OrganizationSwitcher
					organizations={[
						{
							name: "Acme Inc",
							logo: <GalleryVerticalEndIcon />,
							plan: "Enterprise",
						},
						{
							name: "Acme Corp.",
							logo: <AudioLinesIcon />,
							plan: "Startup",
						},
						{
							name: "Evil Corp.",
							logo: <TerminalIcon />,
							plan: "Free",
						},
					]}
				/>
			</SidebarHeader>
			<SidebarContent>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton
							href="/app"
							onClick={(e: React.MouseEvent) => {
								e.preventDefault();
								navigate({ to: "/app" });
							}}
						>
							<LayoutDashboardIcon />
							<span>Dashboard</span>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
				<NavMain
					items={[
						{
							title: "Settings",
							url: "/app/settings",
							icon: <Settings2Icon />,
							items: [
								{ title: "General", url: "/app/settings" },
								{ title: "Members", url: "/app/settings/members" },
							],
						},
					]}
				/>
			</SidebarContent>
			<SidebarFooter>
				<NavUser
					user={
						user ?? {
							name: "shadcn",
							email: "m@example.com",
							avatar: "/avatars/shadcn.jpg",
						}
					}
					onSignOut={onSignOut}
				/>
			</SidebarFooter>
			<SidebarRail />
		</Sidebar>
	);
}
