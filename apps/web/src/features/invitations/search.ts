import type {
	InvitationHistoryQuery,
	InvitationRoleFilter,
	InvitationStatus,
} from "./api";

/**
 * URL search schema for the Invitations page.
 *
 * Why its own module: the route validates the URL and the Members page links
 * to the default view. Sharing the defaults keeps the link and the validator
 * from drifting, and gives every navigation to the page the same starting
 * state.
 *
 * Used by: routes/_app/$orgSlug.settings.invitations.tsx and the Members page
 * summary link.
 */

export type InvitationsSearch = {
	status: "all" | InvitationStatus;
	role: InvitationRoleFilter;
	search: string;
	page: number;
	pageSize: number;
	sort: InvitationHistoryQuery["sort"];
	direction: InvitationHistoryQuery["direction"];
};

/** The unfiltered first page of history. */
export const DEFAULT_INVITATIONS_SEARCH: InvitationsSearch = {
	status: "all",
	role: "all",
	search: "",
	page: 1,
	pageSize: 20,
	sort: "createdAt",
	direction: "desc",
};

const STATUS_VALUES = [
	"all",
	"pending",
	"expired",
	"accepted",
	"canceled",
	"rejected",
] as const;

const SORT_VALUES = ["createdAt", "expiresAt", "email", "status"] as const;
const ROLE_VALUES = ["all", "owner", "admin", "member"] as const;

/**
 * Clamp anything the browser sends.
 *
 * A hand edited query string must never reach the API as a negative page or an
 * arbitrary sort key. Unknown values fall back to the defaults above.
 */
export function normalizeInvitationsSearch(
	raw: Record<string, unknown>,
): InvitationsSearch {
	const status = STATUS_VALUES.includes(
		raw.status as (typeof STATUS_VALUES)[number],
	)
		? (raw.status as InvitationsSearch["status"])
		: DEFAULT_INVITATIONS_SEARCH.status;

	const sort = SORT_VALUES.includes(raw.sort as (typeof SORT_VALUES)[number])
		? (raw.sort as InvitationsSearch["sort"])
		: DEFAULT_INVITATIONS_SEARCH.sort;

	const role = ROLE_VALUES.includes(raw.role as (typeof ROLE_VALUES)[number])
		? (raw.role as InvitationRoleFilter)
		: DEFAULT_INVITATIONS_SEARCH.role;

	const page = Number(raw.page);
	const pageSize = Number(raw.pageSize);

	return {
		status,
		role,
		search: typeof raw.search === "string" ? raw.search : "",
		page: Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1,
		pageSize:
			pageSize === 10 || pageSize === 20 || pageSize === 50
				? pageSize
				: DEFAULT_INVITATIONS_SEARCH.pageSize,
		sort,
		direction: raw.direction === "asc" ? "asc" : "desc",
	};
}
