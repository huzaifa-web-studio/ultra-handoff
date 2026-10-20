import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
} from "@org/ui/components/sidebar";
import {
	AudioLinesIcon,
	BookOpenIcon,
	BotIcon,
	FrameIcon,
	GalleryVerticalEndIcon,
	MapIcon,
	PieChartIcon,
	Settings2Icon,
	TerminalIcon,
	TerminalSquareIcon,
} from "lucide-react";
import type * as React from "react";
import { NavMain } from "./nav-main";
import { NavProjects } from "./nav-projects";
import { NavUser } from "./nav-user";
import { OrganizationSwitcher } from "./organization-switcher";

// This is sample data.
const data = {
	user: {
		name: "shadcn",
		email: "m@example.com",
		avatar: "/avatars/shadcn.jpg",
	},
	organizations: [
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
	],
	navMain: [
		{
			title: "Playground",
			url: "#",
			icon: <TerminalSquareIcon />,
			isActive: true,
			items: [
				{
					title: "History",
					url: "#",
				},
				{
					title: "Starred",
					url: "#",
				},
				{
					title: "Settings",
					url: "#",
				},
			],
		},
		{
			title: "Models",
			url: "#",
			icon: <BotIcon />,
			items: [
				{
					title: "Genesis",
					url: "#",
				},
				{
					title: "Explorer",
					url: "#",
				},
				{
					title: "Quantum",
					url: "#",
				},
			],
		},
		{
			title: "Documentation",
			url: "#",
			icon: <BookOpenIcon />,
			items: [
				{
					title: "Introduction",
					url: "#",
				},
				{
					title: "Get Started",
					url: "#",
				},
				{
					title: "Tutorials",
					url: "#",
				},
				{
					title: "Changelog",
					url: "#",
				},
			],
		},
		{
			title: "Settings",
			url: "#",
			icon: <Settings2Icon />,
			items: [
				{
					title: "General",
					url: "#",
				},
				{
					title: "Team",
					url: "#",
				},
				{
					title: "Billing",
					url: "#",
				},
				{
					title: "Limits",
					url: "#",
				},
			],
		},
	],
	projects: [
		{
			name: "Design Engineering",
			url: "#",
			icon: <FrameIcon />,
		},
		{
			name: "Sales & Marketing",
			url: "#",
			icon: <PieChartIcon />,
		},
		{
			name: "Travel",
			url: "#",
			icon: <MapIcon />,
		},
	],
};

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
	return (
		<Sidebar collapsible="icon" {...props}>
			<SidebarHeader>
				<OrganizationSwitcher organizations={data.organizations} />
			</SidebarHeader>
			<SidebarContent>
				<NavMain items={data.navMain} />
				<NavProjects projects={data.projects} />
			</SidebarContent>
			<SidebarFooter>
				<NavUser user={user ?? data.user} onSignOut={onSignOut} />
			</SidebarFooter>
		</Sidebar>
	);
}
