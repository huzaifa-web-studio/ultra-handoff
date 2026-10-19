import {
	SidebarContent,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@org/ui/components/sidebar";
import { useNavigate } from "@tanstack/react-router";
import { LayoutDashboard } from "lucide-react";

export function AppSidebarMenu() {
	const navigate = useNavigate();

	return (
		<SidebarContent>
			<SidebarMenu>
				<SidebarMenuItem>
					<SidebarMenuButton
						isActive
						tooltip="Dashboard"
						onPress={() => navigate({ to: "/app" })}
					>
						<LayoutDashboard className="h-4 w-4 " />
						<span>Dashboard</span>
					</SidebarMenuButton>
				</SidebarMenuItem>
			</SidebarMenu>
		</SidebarContent>
	);
}
