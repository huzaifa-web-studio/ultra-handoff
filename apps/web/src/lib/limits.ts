/**
 * Input limits shared by more than one feature.
 *
 * Why: the API is authoritative, but every form has to state its maximum
 * before a request is made. Limits that belong to one feature live with that
 * feature's schema (projects, organization, password). These two are used by
 * several features, so they live here to stop the numbers drifting apart.
 *
 * Used by: auth, account, invitations and the data table selection handlers.
 */

/** Longest email address the invitation routes and Better Auth accept. */
export const EMAIL_MAX = 254;

/** Longest display name accepted by the profile form. */
export const USER_NAME_MAX = 64;

/** Largest batch accepted by a bulk action route. */
export const BULK_SELECTION_MAX = 100;

/**
 * How many projects the sidebar requests per page.
 *
 * The sidebar lists every project the caller can see, so it loads in small
 * pages as the user scrolls instead of one large payload.
 */
export const SIDEBAR_PROJECTS_PAGE_SIZE = 20;

/**
 * Most projects one person can pin in one workspace. Mirrors the API cap; the
 * API remains authoritative and rejects anything beyond it.
 */
export const SIDEBAR_PROJECT_PIN_MAX = 5;
