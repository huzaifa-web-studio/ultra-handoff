/**
 * Dynamic project label for the app header breadcrumb.
 *
 * Why a store: the header renders the breadcrumb from route `staticData`,
 * which is static by definition, while the project name lives in the project
 * query. The project page publishes the name here while it is mounted, and the
 * header substitutes it for the generic "Project" crumb. Unmounting clears it,
 * so no other page can inherit a stale name.
 *
 * Used by: components/app-sidebar/app-header.tsx and the project page.
 */

import { Store } from "@tanstack/store";

export const projectBreadcrumbStore = new Store<{ label: string | null }>({
	label: null,
});

/** Set the current project name, or clear it when leaving the page. */
export function setProjectBreadcrumbLabel(label: string | null): void {
	if (projectBreadcrumbStore.state.label === label) return;

	projectBreadcrumbStore.setState(() => ({ label }));
}
