import { z } from "zod";

import { passwordRule, passwordRuleMessage } from "#/lib/password";

export const signInSchema = z.object({
	email: z.email("Invalid email"),
	password: z.string().min(1, "Password is required"),
});

export const signUpSchema = z.object({
	name: z.string().min(1, "Name is required"),
	email: z.email("Invalid email"),
	password: z.string().regex(passwordRule, passwordRuleMessage),
});

/** Request a reset link. The email is the only field. */
export const forgotPasswordSchema = z.object({
	email: z.email("Invalid email"),
});

/** Set a new password from an emailed reset link. */
export const resetPasswordSchema = z.object({
	newPassword: z.string().regex(passwordRule, passwordRuleMessage),
	confirmPassword: z.string().min(1, "Confirm your new password"),
});

export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;
