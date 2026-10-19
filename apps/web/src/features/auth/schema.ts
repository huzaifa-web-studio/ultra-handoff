import { z } from "zod";

export const signInSchema = z.object({
	email: z.email("Invalid email"),
	password: z.string().min(1, "Password is required"),
});

export const signUpSchema = z.object({
	name: z.string().min(1, "Name is required"),
	email: z.email("Invalid email"),
	password: z
		.string()
		.regex(
			/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/,
			"Password must be 8+ chars with upper, lower, number, and special char",
		),
});
