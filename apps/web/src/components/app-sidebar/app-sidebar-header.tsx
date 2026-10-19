import { SidebarHeader, useSidebar } from "@org/ui/components/sidebar";

export function AppSidebarHeader() {
	const { state } = useSidebar();

	return (
		<SidebarHeader className={"overflow-hidden"}>
			<span className="px-2 py-1 font-display text-lg font-bold whitespace-nowrap">
				{state === "collapsed" ? "UH" : "Ultra Handoff"}
			</span>
		</SidebarHeader>
	);
}
