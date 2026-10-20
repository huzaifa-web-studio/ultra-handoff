"use client";

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
import { ChevronsUpDownIcon, LogOutIcon, UserIcon } from "lucide-react";

import { UserAvatar } from "#/components/user-avatar";

export function NavUser({
	user,
	onSignOut,
}: {
	user: {
		name: string;
		email: string;
		avatar?: string;
	};
	onSignOut?: () => void | Promise<void>;
}) {
	const { isMobile } = useSidebar();
	const navigate = useNavigate();
	return (
		<SidebarMenu>
			<SidebarMenuItem>
				<DropdownMenuTrigger>
					<SidebarMenuButton
						size="lg"
						className="aria-expanded:bg-sidebar-accent aria-expanded:text-sidebar-accent-foreground"
					>
						<UserAvatar src={user.avatar} name={user.name} />
						<div className="grid flex-1 text-left text-sm leading-tight">
							<span className="truncate font-medium">{user.name}</span>
							<span className="truncate text-xs">{user.email}</span>
						</div>
						<ChevronsUpDownIcon className="ml-auto size-4" />
					</SidebarMenuButton>
					<DropdownMenu
						className="w-fit"
						placement={isMobile ? "bottom end" : "right bottom"}
						offset={4}
					>
						<DropdownMenuGroup>
							<DropdownMenuLabel className="p-0 font-normal">
								<div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
									<UserAvatar src={user.avatar} name={user.name} />
									<div className="grid flex-1 text-left text-sm leading-tight">
										<span className="truncate font-medium">{user.name}</span>
										<span className="truncate text-xs">{user.email}</span>
									</div>
								</div>
							</DropdownMenuLabel>
						</DropdownMenuGroup>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							className="cursor-pointer"
							onAction={() => {
								navigate({ to: "/account" });
							}}
						>
							<UserIcon />
							Account
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							className="cursor-pointer"
							onAction={() => onSignOut?.()}
						>
							<LogOutIcon />
							Sign Out
						</DropdownMenuItem>
					</DropdownMenu>
				</DropdownMenuTrigger>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}
