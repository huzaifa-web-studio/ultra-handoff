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
