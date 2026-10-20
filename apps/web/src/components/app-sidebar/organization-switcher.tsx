import {
	DropdownMenu,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@org/ui/components/dropdown-menu";

import {
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebar,
} from "@org/ui/components/sidebar";
import { useNavigate } from "@tanstack/react-router";
import { ChevronsUpDownIcon, PlusIcon } from "lucide-react";
import * as React from "react";
import { authClient } from "#/features/auth/client";
import { OrganizationDialog } from "#/features/organization/organization-dialog";

export function OrganizationSwitcher() {
	const { isMobile } = useSidebar();
	const navigate = useNavigate();
	const { data: organizations } = authClient.useListOrganizations();
	const { data: activeOrganization } = authClient.useActiveOrganization();
	const orgs = organizations ?? [];
	const [dialogOpen, setDialogOpen] = React.useState(false);

	if (!activeOrganization) {
		if (orgs.length === 0) {
			return null;
		}
		return null;
	}

	return (
		<>
			<SidebarMenu>
				<SidebarMenuItem>
					<DropdownMenuTrigger>
						<SidebarMenuButton
							size="lg"
							className="aria-expanded:bg-sidebar-accent aria-expanded:text-sidebar-accent-foreground"
						>
							<div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
								{activeOrganization.logo ?? activeOrganization.name?.[0]}
							</div>
							<div className="grid flex-1 text-left text-sm leading-tight">
								<span className="truncate font-medium">
									{activeOrganization.name}
								</span>
								<span className="truncate text-xs">
									{activeOrganization.slug}
								</span>
							</div>
							<ChevronsUpDownIcon className="ml-auto" />
						</SidebarMenuButton>
						<DropdownMenu
							className="w-fit !bg-popover"
							placement={isMobile ? "bottom start" : "right top"}
							offset={4}
						>
							<DropdownMenuGroup className="max-h-48 overflow-y-auto">
								<DropdownMenuLabel className="sticky top-0 z-10 bg-popover text-xs text-muted-foreground">
									Organizations
								</DropdownMenuLabel>
								{orgs.map((organization) => (
									<DropdownMenuItem
										key={organization.id}
										onAction={async () => {
											await authClient.organization.setActive({
												organizationId: organization.id,
											});
											navigate({
												to: "/$orgSlug",
												params: { orgSlug: organization.slug },
											});
										}}
										className="cursor-pointer gap-2 p-2"
									>
										<div className="flex size-6 items-center justify-center rounded-md border">
											{organization.logo ?? organization.name?.[0]}
										</div>
										{organization.name}
									</DropdownMenuItem>
								))}
							</DropdownMenuGroup>
							<DropdownMenuSeparator />
							<DropdownMenuGroup>
								<DropdownMenuItem
									className="cursor-pointer gap-2 p-2"
									onAction={() => setDialogOpen(true)}
								>
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
			<OrganizationDialog
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				onSuccess={() => {
					setDialogOpen(false);
				}}
			/>
		</>
	);
}
