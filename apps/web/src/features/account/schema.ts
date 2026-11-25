/**
 * Validation schemas for the account settings forms.
 *
 * Why zod: the forms use TanStack Form, and the rest of the auth feature
 * already validates with zod. Keeping the same style means error rendering is
 * consistent across sign-in, sign-up and account settings.
 *
 * Used by: the account feature forms.
 */

import { z } from "zod";

import {
	USER_BIO_MAX,
	USER_JOB_TITLE_MAX,
	USER_LOCATION_MAX,
	USER_NAME_MAX,
} from "#/lib/limits";
import { passwordRule, passwordRuleMessage } from "#/lib/password";

export const profileSchema = z.object({
	name: z
		.string()
		.trim()
		.min(1, "Name is required")
		.max(USER_NAME_MAX, `Name must be ${USER_NAME_MAX} characters or fewer`),
	jobTitle: z
		.string()
		.max(
			USER_JOB_TITLE_MAX,
			`Job title must be ${USER_JOB_TITLE_MAX} characters or fewer`,
		),
	bio: z
		.string()
		.max(USER_BIO_MAX, `Bio must be ${USER_BIO_MAX} characters or fewer`),
	location: z
		.string()
		.max(
			USER_LOCATION_MAX,
			`Location must be ${USER_LOCATION_MAX} characters or fewer`,
		),
});

export const changePasswordSchema = z.object({
	currentPassword: z.string().min(1, "Current password is required"),
	newPassword: z.string().regex(passwordRule, passwordRuleMessage),
	confirmPassword: z.string().min(1, "Confirm your new password"),
});

export const setPasswordSchema = z.object({
	newPassword: z.string().regex(passwordRule, passwordRuleMessage),
	confirmPassword: z.string().min(1, "Confirm your new password"),
});

export type ChangePasswordValues = z.infer<typeof changePasswordSchema>;
export type SetPasswordValues = z.infer<typeof setPasswordSchema>;
