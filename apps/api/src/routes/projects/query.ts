/**
 * Project list query parsing.
 *
 * Why this file: only the list and sidebar routes read these filters, and the
 * parser clamps the sort, status and page before the service sees them.
 *
 * Used by: `routes/projects/index.ts`.
 */

import type { ProjectListQuery, ProjectSort } from "../../services/project";
import { PROJECT_SORTS, PROJECT_STATUSES } from "./schemas";

export function parseProjectQuery(query: {
	search?: string;
	status?: string;
	sort?: string;
	direction?: string;
	page?: string;
	pageSize?: string;
}): ProjectListQuery {
	const status = (PROJECT_STATUSES as readonly string[]).includes(
		query.status ?? "",
	)
		? (query.status as "all" | "active" | "archived")
		: "active";

	const sort = (PROJECT_SORTS as readonly string[]).includes(query.sort ?? "")
		? (query.sort as ProjectSort)
		: "createdAt";

	const page = Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1);
	const pageSize = Math.min(
		50,
		Math.max(10, Number.parseInt(query.pageSize ?? "20", 10) || 20),
	);

	return {
		search: query.search ?? "",
		status,
		sort,
		direction: query.direction === "asc" ? "asc" : "desc",
		page,
		pageSize,
	};
}
