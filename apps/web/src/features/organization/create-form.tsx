import { Button } from "@org/ui/components/button";
import { Field, FieldError, FieldLabel } from "@org/ui/components/field";
import { Input } from "@org/ui/components/input";
import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import { authClient } from "#/features/auth/client";
import { toFieldErrors } from "#/lib/form-errors";
import { createOrganizationSchema } from "./schema";
import { resetOrganizationDialog } from "./store";
import { useSwitchOrganization } from "./switch";

export function CreateOrganizationForm({
	onSuccess,
}: {
	onSuccess?: (organizationId: string) => void;
} = {}) {
	const switchOrganization = useSwitchOrganization();
	const [error, setError] = useState<string | null>(null);

	const form = useForm({
		defaultValues: { name: "", slug: "" },
		// Validate the whole object on submit only. Live feedback comes from
		// each field's own onChange validator, so typing in one input never
		// marks the untouched ones as invalid.
		validators: { onSubmit: createOrganizationSchema },
		onSubmit: async ({ value }) => {
			setError(null);
			try {
				// Trim here as well as in the schema: the form hands back the
				// raw field values, and the API rejects a slug with surrounding
				// spaces instead of silently rewriting it.
				const { data: org, error } = await authClient.organization.create({
					name: value.name.trim(),
					slug: value.slug.trim(),
				});
				if (error || !org) {
					setError(error?.message ?? "Failed to create organization");
					return;
				}

				// Close the prompt before switching. The switch leaves the
				// home page, and the dialog state is shared with the switcher
				// in the app shell, so an open prompt would follow them there.
				resetOrganizationDialog();

				const result = await switchOrganization({
					organizationId: org.id,
					organizationSlug: org.slug,
					organizationName: org.name,
				});

				onSuccess?.(org.id);

				if (result.status === "blocked") {
					// The workspace exists and is available in the switcher. The
					// guard dialog explains why it is not active yet.
					return;
				}
			} catch (err) {
				setError(
					err instanceof Error ? err.message : "Failed to create organization",
				);
			}
		},
	});

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				e.stopPropagation();
				form.handleSubmit();
			}}
			className="flex flex-col gap-4"
		>
			<form.Field
				name="name"
				validators={{ onChange: createOrganizationSchema.shape.name }}
			>
				{(field) => (
					<Field>
						<FieldLabel>Organization name</FieldLabel>
						<Input
							type="text"
							autoFocus
							tabIndex={0}
							value={field.state.value}
							onBlur={field.handleBlur}
							onChange={(e) => {
								field.handleChange(e.target.value);
								// auto-slug
								const slug = e.target.value
									.toLowerCase()
									.replace(/[^a-z0-9]+/g, "-")
									.replace(/^-|-$/g, "");
								// The user is editing the name, not the slug. Only
								// revalidate the slug once they have touched it, so
								// a derived value never flags an untouched field.
								const slugTouched = form.getFieldMeta("slug")?.isTouched;
								form.setFieldValue("slug", slug, {
									dontUpdateMeta: !slugTouched,
									dontValidate: !slugTouched,
								});
							}}
						/>
						<FieldError errors={toFieldErrors(field.state.meta.errors)} />
					</Field>
				)}
			</form.Field>
			<form.Field
				name="slug"
				validators={{ onChange: createOrganizationSchema.shape.slug }}
			>
				{(field) => (
					<Field>
						<FieldLabel>Slug</FieldLabel>
						<Input
							type="text"
							value={field.state.value}
							onBlur={field.handleBlur}
							onChange={(e) => field.handleChange(e.target.value)}
						/>
						<FieldError errors={toFieldErrors(field.state.meta.errors)} />
					</Field>
				)}
			</form.Field>
			{error && <p className="text-sm text-danger">{error}</p>}
			<form.Subscribe selector={(s) => s.isSubmitting}>
				{(isSubmitting) => (
					<Button type="submit" loading={isSubmitting}>
						{isSubmitting ? "Creating..." : "Create organization"}
					</Button>
				)}
			</form.Subscribe>
		</form>
	);
}
