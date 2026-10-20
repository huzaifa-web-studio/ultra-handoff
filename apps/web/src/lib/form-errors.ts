/**
 * Normalise form field errors for rendering.
 *
 * Why: TanStack Form hands back Standard Schema issues (objects with a
 * `message`) when a zod validator runs, and plain strings when a custom
 * validator is used. Rendering the raw value turns the common zod case into
 * "[object Object]", so every form funnels its errors through here.
 *
 * Used by: the auth, organization and account forms.
 */

/** Convert any field error shape into the `{ message }` shape FieldError wants. */
export function toFieldErrors(
	errors: readonly unknown[],
): Array<{ message: string }> {
	return errors.map((error) => ({ message: errorMessage(error) }));
}

function errorMessage(error: unknown): string {
	if (typeof error === "string") return error;

	if (error && typeof error === "object" && "message" in error) {
		const message = (error as { message?: unknown }).message;
		if (typeof message === "string" && message.length > 0) return message;
	}

	return "This field is invalid";
}
