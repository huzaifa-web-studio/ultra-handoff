import { Sidebar } from "@org/ui/components/sidebar";
import { AppSidebarHeader } from "./app-sidebar-header";
import { AppSidebarMenu } from "./app-sidebar-menu";

export function AppSidebar() {
	return (
		<Sidebar collapsible="icon" className="bg-app-panel-subtle">
			<AppSidebarHeader />
			<AppSidebarMenu />
		</Sidebar>
	);
}
