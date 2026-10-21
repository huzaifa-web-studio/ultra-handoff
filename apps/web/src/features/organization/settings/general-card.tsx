/**
 * General organization settings.
 *
 * Owns the logo, the name and the slug. Owners and admins can edit, members
 * see the same values read only. The card is the only place that knows how to
 * sequence a slug change: save, then move the browser to the new URL.
 *
 * Used by: src/routes/_app/$orgSlug.settings.tsx.
 */

import { Button } from "@org/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@org/ui/components/card";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
} from "@org/ui/components/field";
import { Input } from "@org/ui/components/input";
import { Separator } from "@org/ui/components/separator";
import { useForm } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { broadcastAuth } from "#/features/auth/sync";
import { useAutoDismiss } from "#/hooks/use-auto-dismiss";
import { toFieldErrors } from "#/lib/form-errors";
import { useUpdateOrganization } from "./hooks";
import { OrganizationLogoUploader } from "./logo-uploader";
import { organizationSettingsSchema } from "./schema";

type GeneralCardProps = {
	organization: {
		id: string;
		name: string;
		slug: string;
		logo?: string | null;
	};
	/** Owners and admins can edit. Members see a read-only form. */
	canEdit: boolean;
	/** Called after a successful save so the page can refresh shared state. */
	onChanged: () => void | Promise<void>;
};

export function GeneralCard({
	organization,
	canEdit,
	onChanged,
}: GeneralCardProps) {
	const navigate = useNavigate();
	const updateOrganization = useUpdateOrganization();
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState<string | null>(null);

	useAutoDismiss(saved, () => setSaved(null));

	const form = useForm({
		defaultValues: { name: organization.name, slug: organization.slug },
		// Validate the whole object on submit only. Live feedback comes from
		// each field's own onChange validator, so typing in one input never
		// marks the other one invalid.
		validators: { onSubmit: organizationSettingsSchema },
		onSubmit: async ({ value }) => {
			setError(null);
			setSaved(null);

			const name = value.name.trim();
			const slug = value.slug.trim();

			if (name === organization.name && slug === organization.slug) {
				setSaved("No changes to save.");
				return;
			}

			try {
				const updated = await updateOrganization.mutateAsync({
					organizationId: organization.id,
					name,
					slug,
				});

				// The write already succeeded. A failed refresh must not turn
				// into a misleading "could not update" message.
				try {
					await onChanged();
				} catch {
					// The active organization atom refetches on its own.
				}

				form.reset({ name: updated.name, slug: updated.slug });
				setSaved("Organization updated.");

				// The slug is part of every URL under this workspace, so the
				// browser has to move to the new address before the old one
				// starts returning 404.
				if (updated.slug !== organization.slug) {
					broadcastAuth("auth:org-changed", {
						slug: updated.slug,
						previousSlug: organization.slug,
					});
					navigate({
						to: "/$orgSlug/settings",
						params: { orgSlug: updated.slug },
						replace: true,
					});
				}
			} catch (submitError) {
				setError(
					submitError instanceof Error
						? submitError.message
						: "Could not update the organization.",
				);
			}
		},
	});

	// Switching organizations reuses this component, so reset the fields to
	// the newly active organization instead of keeping the previous values.
	useEffect(() => {
		form.reset({ name: organization.name, slug: organization.slug });
	}, [organization.name, organization.slug, form]);

	return (
		<Card>
			<CardHeader>
				<CardTitle>General</CardTitle>
				<CardDescription>
					How your organization appears in Handoff, and the address your team
					uses to reach it.
				</CardDescription>
			</CardHeader>

			<CardContent className="flex flex-col gap-6">
				<OrganizationLogoUploader
					organizationId={organization.id}
					organizationSlug={organization.slug}
					name={organization.name}
					logo={organization.logo}
					canEdit={canEdit}
					onChanged={onChanged}
				/>

				<Separator />

				{!canEdit && (
					<p className="border border-app-border bg-app-panel-subtle p-3 text-sm text-app-text-muted">
						Only owners and admins can change these settings.
					</p>
				)}

				<form
					onSubmit={(event) => {
						event.preventDefault();
						event.stopPropagation();
						form.handleSubmit();
					}}
					className="flex flex-col gap-5"
				>
					<form.Field
						name="name"
						validators={{ onChange: organizationSettingsSchema.shape.name }}
					>
						{(field) => (
							<Field>
								<FieldLabel htmlFor="organization-name">
									Organization name
								</FieldLabel>
								<Input
									id="organization-name"
									type="text"
									autoComplete="organization"
									value={field.state.value}
									disabled={!canEdit}
									onBlur={field.handleBlur}
									onChange={(event) => field.handleChange(event.target.value)}
								/>
								<FieldError errors={toFieldErrors(field.state.meta.errors)} />
								<FieldDescription>
									Shown in the sidebar, the switcher and every email your
									clients receive.
								</FieldDescription>
							</Field>
						)}
					</form.Field>

					<form.Field
						name="slug"
						validators={{ onChange: organizationSettingsSchema.shape.slug }}
					>
						{(field) => (
							<Field>
								<FieldLabel htmlFor="organization-slug">Slug</FieldLabel>
								<Input
									id="organization-slug"
									type="text"
									autoComplete="off"
									spellCheck={false}
									value={field.state.value}
									disabled={!canEdit}
									onBlur={field.handleBlur}
									onChange={(event) =>
										field.handleChange(event.target.value.toLowerCase())
									}
								/>
								<FieldError errors={toFieldErrors(field.state.meta.errors)} />
								<FieldDescription>
									Your workspace lives at{" "}
									<span className="font-medium text-app-text">
										/{field.state.value || "your-slug"}
									</span>
									. Changing it breaks links people already have, so tell your
									team after saving.
								</FieldDescription>
							</Field>
						)}
					</form.Field>

					{error && (
						<p role="alert" className="text-sm text-danger">
							{error}
						</p>
					)}

					{saved && !error && (
						<output className="block text-sm text-success">{saved}</output>
					)}

					{canEdit && (
						<div>
							<form.Subscribe selector={(state) => state.isSubmitting}>
								{(isSubmitting) => (
									<Button type="submit" loading={isSubmitting}>
										{isSubmitting ? "Saving..." : "Save changes"}
									</Button>
								)}
							</form.Subscribe>
						</div>
					)}
				</form>
			</CardContent>
		</Card>
	);
}
