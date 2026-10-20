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
import { useLocation, useNavigate } from "@tanstack/react-router";
import { LayoutDashboardIcon, Settings2Icon } from "lucide-react";
import type * as React from "react";
import { authClient } from "#/features/auth/client";
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
	const { pathname } = useLocation();
	const { data: activeOrg } = authClient.useActiveOrganization();
	const orgSlug = activeOrg?.slug ?? "";
	return (
		<Sidebar collapsible="icon" {...props}>
			<SidebarHeader>
				<OrganizationSwitcher />
			</SidebarHeader>
			<SidebarContent>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton
							href={`/${orgSlug}`}
							isActive={pathname === `/${orgSlug}`}
							onClick={(e: React.MouseEvent) => {
								e.preventDefault();
								if (orgSlug) navigate({ to: "/$orgSlug", params: { orgSlug } });
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
							url: `/${orgSlug}/settings`,
							icon: <Settings2Icon />,
							items: [
								{ title: "General", url: `/${orgSlug}/settings` },
								{ title: "Members", url: `/${orgSlug}/settings/members` },
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
