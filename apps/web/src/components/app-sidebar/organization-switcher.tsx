import {
	DropdownMenu,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuTrigger,
} from "@org/ui/components/dropdown-menu";
import {
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebar,
} from "@org/ui/components/sidebar";
import { ChevronsUpDownIcon, PlusIcon } from "lucide-react";
import * as React from "react";

export function OrganizationSwitcher({
	organizations,
}: {
	organizations: {
		name: string;
		logo: React.ReactNode;
		plan: string;
	}[];
}) {
	const { isMobile } = useSidebar();
	const [activeOrganization, setActiveOrganization] = React.useState(
		organizations[0],
	);
	if (!activeOrganization) {
		return null;
	}
	return (
		<SidebarMenu>
			<SidebarMenuItem>
				<DropdownMenuTrigger>
					<SidebarMenuButton
						size="lg"
						className="aria-expanded:bg-sidebar-accent aria-expanded:text-sidebar-accent-foreground"
					>
						<div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
							{activeOrganization.logo}
						</div>
						<div className="grid flex-1 text-left text-sm leading-tight">
							<span className="truncate font-medium">
								{activeOrganization.name}
							</span>
							<span className="truncate text-xs">
								{activeOrganization.plan}
							</span>
						</div>
						<ChevronsUpDownIcon className="ml-auto" />
					</SidebarMenuButton>
					<DropdownMenu
						className="w-fit"
						placement={isMobile ? "bottom start" : "right top"}
						offset={4}
					>
						<DropdownMenuGroup>
							<DropdownMenuLabel className="text-xs text-muted-foreground">
								Organizations
							</DropdownMenuLabel>
							{organizations.map((organization, index) => (
								<DropdownMenuItem
									key={organization.name}
									onAction={() => setActiveOrganization(organization)}
									className="gap-2 p-2"
								>
									<div className="flex size-6 items-center justify-center rounded-md border">
										{organization.logo}
									</div>
									{organization.name}
									<DropdownMenuShortcut>⌘{index + 1}</DropdownMenuShortcut>
								</DropdownMenuItem>
							))}
						</DropdownMenuGroup>
						<DropdownMenuSeparator />
						<DropdownMenuGroup>
							<DropdownMenuItem className="gap-2 p-2">
								<div className="flex size-6 items-center justify-center rounded-md border bg-transparent">
									<PlusIcon className="size-4" />
								</div>
								<div className="font-medium text-muted-foreground">
									Add organization
								</div>
							</DropdownMenuItem>
						</DropdownMenuGroup>
					</DropdownMenu>
				</DropdownMenuTrigger>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}
