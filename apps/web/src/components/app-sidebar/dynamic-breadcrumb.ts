/**
 * Dynamic label for one app header breadcrumb.
 *
 * Why a store: the header renders the breadcrumb from route `staticData`, which
 * is static by definition, while the real label (a project name, a person's
 * name) lives in a query. The owning page publishes the label here while it is
 * mounted, and the header substitutes it for the crumb whose static label
 * matches `key`. Unmounting clears it, so no other page can inherit a stale
 * name.
 *
 * One store, one key: two pages are never on screen at the same time, and the
 * key prevents a profile from replacing a project crumb during a transition.
 *
 * Used by: components/app-sidebar/app-header.tsx, the project workspace and the
 * member profile page.
 */

import { Store } from "@tanstack/store";

export type DynamicBreadcrumb = {
	/** The `staticData.breadcrumb` value this label replaces. */
	key: string;
	label: string;
};

export const dynamicBreadcrumbStore = new Store<{
	current: DynamicBreadcrumb | null;
}>({ current: null });

/** Publish a label for one crumb, or clear it when leaving the page. */
export function setDynamicBreadcrumbLabel(
	key: string,
	label: string | null,
): void {
	const current = dynamicBreadcrumbStore.state.current;

	if (label === null) {
		if (current?.key !== key) return;

		dynamicBreadcrumbStore.setState(() => ({ current: null }));
		return;
	}

	if (current?.key === key && current.label === label) return;

	dynamicBreadcrumbStore.setState(() => ({ current: { key, label } }));
}
