import { Button } from "@org/ui/components/button";
import { Field, FieldError, FieldLabel } from "@org/ui/components/field";
import { Input } from "@org/ui/components/input";
import { useForm } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { authClient } from "#/features/auth/client";
import { broadcastAuth } from "#/features/auth/sync";
import { toFieldErrors } from "#/lib/form-errors";
import { createOrganizationSchema } from "./schema";

export function CreateOrganizationForm({
	onSuccess,
}: {
	onSuccess?: (organizationId: string) => void;
} = {}) {
	const navigate = useNavigate();
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
				const { data: org, error } = await authClient.organization.create({
					name: value.name,
					slug: value.slug,
				});
				if (error || !org) {
					setError(error?.message ?? "Failed to create organization");
					return;
				}
				const { error: activeError } = await authClient.organization.setActive({
					organizationId: org.id,
				});
				if (activeError) {
					setError(activeError.message ?? "Failed to switch organization");
					return;
				}
				await authClient.getSession();
				broadcastAuth("auth:org-changed", { slug: org.slug });
				onSuccess?.(org.id);
				navigate({ to: "/$orgSlug", params: { orgSlug: org.slug } });
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
