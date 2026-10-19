import { SidebarHeader, useSidebar } from "@org/ui/components/sidebar";

export function AppSidebarHeader() {
	const { state } = useSidebar();

	return (
		<SidebarHeader>
			<span className="px-2 py-1 font-display text-lg font-bold">
				{state === "collapsed" ? "UH" : "Ultra Handoff"}
			</span>
		</SidebarHeader>
	);
}
