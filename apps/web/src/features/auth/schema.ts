import { z } from "zod";

import { EMAIL_MAX, USER_NAME_MAX } from "#/lib/limits";
import { passwordRule, passwordRuleMessage } from "#/lib/password";

/** An address the API and Better Auth will accept, by length and shape. */
const emailField = z
	.email("Invalid email")
	.max(EMAIL_MAX, `Email must be ${EMAIL_MAX} characters or fewer`);

export const signInSchema = z.object({
	email: emailField,
	password: z.string().min(1, "Password is required"),
});

export const signUpSchema = z.object({
	name: z
		.string()
		.min(1, "Name is required")
		.max(USER_NAME_MAX, `Name must be ${USER_NAME_MAX} characters or fewer`),
	email: emailField,
	password: z.string().regex(passwordRule, passwordRuleMessage),
});

/** Request a reset link. The email is the only field. */
export const forgotPasswordSchema = z.object({
	email: emailField,
});

/** Set a new password from an emailed reset link. */
export const resetPasswordSchema = z.object({
	newPassword: z.string().regex(passwordRule, passwordRuleMessage),
	confirmPassword: z.string().min(1, "Confirm your new password"),
});

export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;
