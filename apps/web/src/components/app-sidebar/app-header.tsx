import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
} from "@org/ui/components/breadcrumb";
import { SidebarTrigger } from "@org/ui/components/sidebar";
import { useMatches, useNavigate } from "@tanstack/react-router";
import { authClient } from "#/features/auth/client";

export function AppHeader() {
	const navigate = useNavigate();
	const matches = useMatches();
	const { data: activeOrg } = authClient.useActiveOrganization();
	const crumbs = matches
		.map((m) => {
			const label = (m.staticData as { breadcrumb?: string } | undefined)
				?.breadcrumb;
			return {
				label: label === "Dashboard" ? (activeOrg?.name ?? label) : label,
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
							<BreadcrumbItem key={crumb.label}>
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
