import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
} from "@org/ui/components/breadcrumb";
import { SidebarTrigger } from "@org/ui/components/sidebar";
import { useMatches, useNavigate } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { authClient } from "#/features/auth/client";
import { projectBreadcrumbStore } from "./project-breadcrumb";

export function AppHeader() {
	const navigate = useNavigate();
	const matches = useMatches();
	const { data: activeOrg } = authClient.useActiveOrganization();
	const projectLabel = useStore(projectBreadcrumbStore).label;
	const crumbs = matches
		.map((m) => {
			const label = (m.staticData as { breadcrumb?: string } | undefined)
				?.breadcrumb;
			// The project page publishes its name while it is mounted, so the
			// last crumb reads the real project instead of "Project".
			const resolved =
				label === "Project" && projectLabel ? projectLabel : label;

			return {
				label:
					resolved === "Dashboard" ? (activeOrg?.name ?? resolved) : resolved,
				pathname: m.pathname,
			};
		})
		.filter((c): c is { label: string; pathname: string } => Boolean(c.label));

	return (
		/*
		 * Sticky so the breadcrumb and sidebar trigger stay reachable while the
		 * page content scrolls. `z-30` keeps it above page content but below
		 * the mobile sidebar sheet. A solid background is intentional: the
		 * content must not show through the bar while scrolling.
		 */
		<header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-app-border bg-background px-4">
			<SidebarTrigger />
			<Breadcrumb>
				<BreadcrumbList>
					{crumbs.map((crumb, index) => {
						const isLast = index === crumbs.length - 1;
						return (
							<BreadcrumbItem key={crumb.pathname}>
								{isLast ? (
									<BreadcrumbPage className="cursor-pointer">
										{crumb.label}
									</BreadcrumbPage>
								) : (
									<BreadcrumbLink
										className="cursor-pointer"
										onPress={() => navigate({ to: crumb.pathname as never })}
									>
										{crumb.label}
									</BreadcrumbLink>
								)}
							</BreadcrumbItem>
						);
					})}
				</BreadcrumbList>
			</Breadcrumb>
		</header>
	);
}
