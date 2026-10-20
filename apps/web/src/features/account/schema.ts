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

import { passwordRule, passwordRuleMessage } from "#/lib/password";

export const profileSchema = z.object({
	name: z
		.string()
		.trim()
		.min(1, "Name is required")
		.max(64, "Name must be 64 characters or fewer"),
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
