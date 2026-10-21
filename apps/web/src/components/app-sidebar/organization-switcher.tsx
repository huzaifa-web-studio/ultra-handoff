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
import { ChevronsUpDownIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";

import { UserAvatar } from "#/components/user-avatar";
import { authClient } from "#/features/auth/client";
import { OrganizationDialog } from "#/features/organization/organization-dialog";
import { openOrganizationDialog } from "#/features/organization/store";
import { useSwitchOrganization } from "#/features/organization/switch";

export function OrganizationSwitcher() {
	const { isMobile } = useSidebar();
	const switchOrganization = useSwitchOrganization();
	const { data: organizations } = authClient.useListOrganizations();
	const { data: activeOrganization } = authClient.useActiveOrganization();
	const orgs = organizations ?? [];

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
							<UserAvatar
								src={activeOrganization.logo}
								name={activeOrganization.name}
								size="default"
								shape="square"
							/>
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
											try {
												await switchOrganization({
													organizationId: organization.id,
													organizationSlug: organization.slug,
													organizationName: organization.name,
												});
											} catch (error) {
												toast.error(
													error instanceof Error
														? error.message
														: "Could not switch organization.",
												);
											}
										}}
										className="cursor-pointer gap-2 p-2"
									>
										<UserAvatar
											src={organization.logo}
											name={organization.name}
											size="sm"
											shape="square"
										/>
										{organization.name}
									</DropdownMenuItem>
								))}
							</DropdownMenuGroup>
							<DropdownMenuSeparator />
							<DropdownMenuGroup>
								<DropdownMenuItem
									className="cursor-pointer gap-2 p-2"
									onAction={() => openOrganizationDialog()}
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
			<OrganizationDialog />
		</>
	);
}
