import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
	SidebarRail,
} from "@org/ui/components/sidebar";

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
		avatar?: string;
	};
	onSignOut?: () => void | Promise<void>;
}) {
	const { data: activeOrg } = authClient.useActiveOrganization();
	const orgSlug = activeOrg?.slug ?? "";
	return (
		<Sidebar collapsible="icon" {...props}>
			<SidebarHeader>
				<OrganizationSwitcher />
			</SidebarHeader>
			<SidebarContent>
				{/*
				 * Without an active organization the dashboard and settings
				 * links would point at `/` and `/settings`, which do not exist.
				 * Account settings still needs the shell, so the nav is simply
				 * empty until an organization is selected.
				 */}
				{activeOrg && (
					<NavMain
						items={[
							{
								title: "Dashboard",
								url: `/${orgSlug}`,
								icon: <LayoutDashboardIcon />,
							},
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
				)}
			</SidebarContent>
			<SidebarFooter>
				<NavUser
					user={
						user ?? {
							name: "shadcn",
							email: "m@example.com",
						}
					}
					onSignOut={onSignOut}
				/>
			</SidebarFooter>
			<SidebarRail />
		</Sidebar>
	);
}
