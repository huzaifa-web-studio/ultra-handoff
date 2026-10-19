import { Button } from "@org/ui/components/button";
import { Field, FieldError, FieldLabel } from "@org/ui/components/field";
import { Input } from "@org/ui/components/input";
import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import { authClient } from "#/features/auth/client";
import { createOrganizationSchema } from "./schema";

export function CreateOrganizationForm() {
	const [error, setError] = useState<string | null>(null);

	const form = useForm({
		defaultValues: { name: "", slug: "" },
		validators: { onChange: createOrganizationSchema },
		onSubmit: async ({ value }) => {
			setError(null);
			try {
				const { error } = await authClient.organization.create({
					name: value.name,
					slug: value.slug,
				});
				if (error) {
					setError(error.message ?? "Failed to create organization");
				}
			} catch (err) {
				setError(err instanceof Error ? err.message : "Failed to create organization");
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
			<form.Field name="name">
				{(field) => (
					<Field>
						<FieldLabel>Organization name</FieldLabel>
						<Input
							type="text"
							value={field.state.value}
							onBlur={field.handleBlur}
							onChange={(e) => {
								field.handleChange(e.target.value);
								// auto-slug
								const slug = e.target.value
									.toLowerCase()
									.replace(/[^a-z0-9]+/g, "-")
									.replace(/^-|-$/g, "");
								form.setFieldValue("slug", slug);
							}}
						/>
						<FieldError
							errors={field.state.meta.errors.map((e) => ({
								message: String(e),
							}))}
						/>
					</Field>
				)}
			</form.Field>
			<form.Field name="slug">
				{(field) => (
					<Field>
						<FieldLabel>Slug</FieldLabel>
						<Input
							type="text"
							value={field.state.value}
							onBlur={field.handleBlur}
							onChange={(e) => field.handleChange(e.target.value)}
						/>
						<FieldError
							errors={field.state.meta.errors.map((e) => ({
								message: String(e),
							}))}
						/>
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
