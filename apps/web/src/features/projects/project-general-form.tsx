/**
 * Shared project create and edit form.
 *
 * Why a separate component: the project dialog and the settings page need the
 * same logo, name, slug and description fields, the same slug suggestion and the
 * same mutations. Keeping one form means a validation or copy change applies to
 * both.
 *
 * The form does not close anything. Callers receive `onCreated` or `onSaved` and
 * decide whether to close a dialog or stay on the page.
 *
 * Used by: project-dialog.tsx and project-settings/general-card.tsx.
 */

import { Button } from "@org/ui/components/button";
import { Field, FieldError, FieldLabel } from "@org/ui/components/field";
import { Input } from "@org/ui/components/input";
import { Textarea } from "@org/ui/components/textarea";
import { useForm } from "@tanstack/react-form";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { FieldMeta } from "#/components/field-meta";
import { toFieldErrors } from "#/lib/form-errors";
import { slugify } from "#/lib/slug";
import type { ProjectDetailResponse, ProjectRow } from "./api";
import { useCreateProject, useUpdateProject } from "./hooks";
import { ProjectLogoUploader } from "./project-logo-uploader";
import {
	PROJECT_DESCRIPTION_MAX,
	PROJECT_NAME_MAX,
	PROJECT_SLUG_MAX,
	PROJECT_SLUG_MIN,
	projectSchema,
} from "./schema";

type ProjectGeneralFormProps = {
	orgSlug: string;
	organizationId: string;
	mode: "create" | "edit";
	/** Required in edit mode. */
	project?: ProjectRow;
	submitLabel?: string;
	/** Omit to hide the cancel action, as on the settings page. */
	onCancel?: () => void;
	onCreated?: () => void;
	onSaved?: (project: ProjectDetailResponse) => void;
	/** Lets a dialog disable dismissal while the request is in flight. */
	onSubmittingChange?: (submitting: boolean) => void;
	/**
	 * Save a logo change immediately instead of waiting for the form submit.
	 * Used by the settings page so the project header updates at once.
	 */
	saveLogoImmediately?: boolean;
	/** Ask before removing a logo. Off inside another dialog. */
	confirmLogoRemoval?: boolean;
};

export function ProjectGeneralForm({
	orgSlug,
	organizationId,
	mode,
	project,
	submitLabel,
	onCancel,
	onCreated,
	onSaved,
	onSubmittingChange,
	saveLogoImmediately = false,
	confirmLogoRemoval = true,
}: ProjectGeneralFormProps) {
	const createProject = useCreateProject(orgSlug);
	const updateProject = useUpdateProject(orgSlug);

	const [logo, setLogo] = useState<string | null>(project?.logo ?? null);
	const [slugTouched, setSlugTouched] = useState(mode === "edit");
	const [error, setError] = useState<string | null>(null);

	const form = useForm({
		defaultValues: {
			name: project?.name ?? "",
			slug: project?.slug ?? "",
			description: project?.description ?? "",
		},
		// Validate the whole object on submit. Live feedback comes from each
		// field's onChange validator, so typing in one input never marks the
		// other one invalid.
		validators: { onSubmit: projectSchema },
		onSubmit: async ({ value }) => {
			setError(null);

			const name = value.name.trim();
			const slug = value.slug.trim();
			const description = value.description.trim();

			try {
				if (mode === "create") {
					await createProject.mutateAsync({
						name,
						slug,
						description: description || undefined,
						logo: logo ?? undefined,
					});
					toast.success(`${name} was created.`);
					onCreated?.();
				} else if (project) {
					const updated = await updateProject.mutateAsync({
						projectId: project.id,
						name,
						slug,
						description,
						// Sending null clears the logo. The API treats an empty
						// string as "remove", so the mapping happens in api.ts.
						logo,
					});
					toast.success(`${name} was updated.`);
					onSaved?.(updated);
				}
			} catch (submitError) {
				setError(
					submitError instanceof Error
						? submitError.message
						: "Could not save the project.",
				);
			}
		},
	});

	const isSubmitting = createProject.isPending || updateProject.isPending;

	// Reset only when the target project changes, not on every refetch. A logo
	// save or a background refresh must not wipe a name the user is typing.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset when the project identity changes
	useEffect(() => {
		form.reset({
			name: project?.name ?? "",
			slug: project?.slug ?? "",
			description: project?.description ?? "",
		});
		setLogo(project?.logo ?? null);
		setSlugTouched(mode === "edit");
		setError(null);
	}, [project?.id, mode, form]);

	/**
	 * Change the logo.
	 *
	 * Inside the dialog the save button applies it. On the settings page the
	 * logo is persisted immediately, so the project header and the sidebar pick
	 * it up without a second step. A failed save restores the previous logo.
	 */
	async function handleLogoChange(next: string | null) {
		if (!saveLogoImmediately || mode !== "edit" || !project) {
			setLogo(next);
			return;
		}

		const previous = logo;
		setLogo(next);
		setError(null);

		try {
			await updateProject.mutateAsync({ projectId: project.id, logo: next });
			toast.success(next ? "Logo updated." : "Logo removed.");
		} catch (logoError) {
			setLogo(previous);
			setError(
				logoError instanceof Error
					? logoError.message
					: "Could not update the logo.",
			);
		}
	}

	useEffect(() => {
		onSubmittingChange?.(isSubmitting);
	}, [isSubmitting, onSubmittingChange]);

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				form.handleSubmit();
			}}
			className="flex flex-col gap-5"
		>
			<ProjectLogoUploader
				organizationId={organizationId}
				organizationSlug={orgSlug}
				name={form.state.values.name}
				value={logo}
				onChange={handleLogoChange}
				disabled={isSubmitting}
				immediate={saveLogoImmediately}
				confirmRemove={confirmLogoRemoval}
			/>

			<form.Field
				name="name"
				validators={{ onChange: projectSchema.shape.name }}
			>
				{(field) => (
					<Field>
						<FieldLabel htmlFor="project-name">Project name</FieldLabel>
						<Input
							id="project-name"
							type="text"
							autoComplete="off"
							maxLength={PROJECT_NAME_MAX}
							value={field.state.value}
							disabled={isSubmitting}
							onBlur={field.handleBlur}
							onChange={(event) => {
								field.handleChange(event.target.value);

								// Keep suggesting a slug until the user edits the
								// slug themselves.
								if (!slugTouched) {
									form.setFieldValue(
										"slug",
										slugify(event.target.value, PROJECT_SLUG_MAX),
									);
								}
							}}
						/>
						<FieldError errors={toFieldErrors(field.state.meta.errors)} />
						<FieldMeta
							counter={{
								current: field.state.value.length,
								max: PROJECT_NAME_MAX,
							}}
						>
							Shown in the projects table and the sidebar.
						</FieldMeta>
					</Field>
				)}
			</form.Field>

			<form.Field
				name="description"
				validators={{ onChange: projectSchema.shape.description }}
			>
				{(field) => (
					<Field>
						<FieldLabel htmlFor="project-description">
							Description (optional)
						</FieldLabel>
						<Textarea
							id="project-description"
							rows={4}
							maxLength={PROJECT_DESCRIPTION_MAX}
							className="max-h-32 overflow-y-auto"
							value={field.state.value}
							disabled={isSubmitting}
							onBlur={field.handleBlur}
							onChange={(event) => field.handleChange(event.target.value)}
						/>
						<FieldError errors={toFieldErrors(field.state.meta.errors)} />
						<FieldMeta
							counter={{
								current: field.state.value.length,
								max: PROJECT_DESCRIPTION_MAX,
							}}
						>
							A short summary of the engagement.
						</FieldMeta>
					</Field>
				)}
			</form.Field>

			<form.Field
				name="slug"
				validators={{ onChange: projectSchema.shape.slug }}
			>
				{(field) => (
					<Field>
						<FieldLabel htmlFor="project-slug">Slug</FieldLabel>
						<Input
							id="project-slug"
							type="text"
							autoComplete="off"
							spellCheck={false}
							maxLength={PROJECT_SLUG_MAX}
							value={field.state.value}
							disabled={isSubmitting}
							onBlur={field.handleBlur}
							onChange={(event) => {
								setSlugTouched(true);
								field.handleChange(event.target.value.toLowerCase());
							}}
						/>
						<FieldError errors={toFieldErrors(field.state.meta.errors)} />
						<FieldMeta
							counter={{
								current: field.state.value.length,
								max: PROJECT_SLUG_MAX,
							}}
						>
							<span>Unique inside this organization.</span>
							<span>
								Lowercase letters, numbers and single hyphens. At least{" "}
								{PROJECT_SLUG_MIN} characters.
							</span>
						</FieldMeta>
					</Field>
				)}
			</form.Field>

			{error && (
				<p role="alert" className="text-sm text-danger">
					{error}
				</p>
			)}

			<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
				{onCancel && (
					<Button
						type="button"
						variant="outline"
						onPress={onCancel}
						isDisabled={isSubmitting}
					>
						Cancel
					</Button>
				)}
				<Button type="submit" loading={isSubmitting}>
					{submitLabel ??
						(mode === "create" ? "Create project" : "Save changes")}
				</Button>
			</div>
		</form>
	);
}
