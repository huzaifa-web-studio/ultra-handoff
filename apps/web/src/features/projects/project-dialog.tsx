/**
 * Create and edit project dialog.
 *
 * One dialog for both modes because the form is identical: logo, name, slug.
 * The only differences are the defaults and which mutation runs on submit.
 *
 * The slug is suggested from the name until the user edits it. After that the
 * two fields are independent, so a long name never overwrites a slug someone
 * chose deliberately.
 *
 * Used by: routes/_app/$orgSlug.projects.tsx.
 */

import { Button } from "@org/ui/components/button";
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@org/ui/components/dialog";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
} from "@org/ui/components/field";
import { Input } from "@org/ui/components/input";
import { Textarea } from "@org/ui/components/textarea";
import { useForm } from "@tanstack/react-form";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { toFieldErrors } from "#/lib/form-errors";
import type { ProjectRow } from "./api";
import { useCreateProject, useUpdateProject } from "./hooks";
import { ProjectLogoUploader } from "./project-logo-uploader";
import {
	PROJECT_DESCRIPTION_MAX,
	projectSchema,
	slugifyProjectName,
} from "./schema";

type ProjectDialogProps = {
	orgSlug: string;
	organizationId: string;
	mode: "create" | "edit";
	/** Required in edit mode. */
	project?: ProjectRow;
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	/** Called after a successful create, so the list can reveal the new row. */
	onCreated?: () => void;
};

export function ProjectDialog({
	orgSlug,
	organizationId,
	mode,
	project,
	isOpen,
	onOpenChange,
	onCreated,
}: ProjectDialogProps) {
	const createProject = useCreateProject(orgSlug);
	const updateProject = useUpdateProject(orgSlug);

	const [logo, setLogo] = useState<string | null>(null);
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
					await updateProject.mutateAsync({
						projectId: project.id,
						name,
						slug,
						description,
						// Sending null clears the logo. The API treats an empty
						// string as "remove", so the mapping happens in api.ts.
						logo,
					});
					toast.success(`${name} was updated.`);
				}

				onOpenChange(false);
			} catch (submitError) {
				setError(
					submitError instanceof Error
						? submitError.message
						: "Could not save the project.",
				);
			}
		},
	});

	// Reset the form every time the dialog opens or the target project changes.
	// Without this, editing project B would show project A's values. The
	// individual fields are listed instead of the row object so a background
	// refetch with identical values does not wipe what the user is typing.
	useEffect(() => {
		if (!isOpen) return;

		form.reset({
			name: project?.name ?? "",
			slug: project?.slug ?? "",
			description: project?.description ?? "",
		});
		setLogo(project?.logo ?? null);
		setSlugTouched(mode === "edit");
		setError(null);
	}, [
		isOpen,
		mode,
		project?.name,
		project?.slug,
		project?.description,
		project?.logo,
		form,
	]);

	const isSubmitting = createProject.isPending || updateProject.isPending;

	return (
		<Dialog
			isOpen={isOpen}
			onOpenChange={onOpenChange}
			className="sm:max-w-lg"
			isDismissable={!isSubmitting}
			showCloseButton={!isSubmitting}
		>
			<DialogHeader>
				<DialogTitle>
					{mode === "create" ? "New project" : "Edit project"}
				</DialogTitle>
				<DialogDescription>
					{mode === "create"
						? "A project holds the scope, deliverables and approvals for one client engagement."
						: "Update how this project appears to its members."}
				</DialogDescription>
			</DialogHeader>

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
					onChange={setLogo}
					disabled={isSubmitting}
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
								value={field.state.value}
								disabled={isSubmitting}
								onBlur={field.handleBlur}
								onChange={(event) => {
									field.handleChange(event.target.value);

									// Keep suggesting a slug until the user edits
									// the slug themselves.
									if (!slugTouched) {
										form.setFieldValue(
											"slug",
											slugifyProjectName(event.target.value),
										);
									}
								}}
							/>
							<FieldError errors={toFieldErrors(field.state.meta.errors)} />
							<FieldDescription>
								Shown in the projects table and the sidebar.
							</FieldDescription>
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
							<FieldDescription>
								A short summary of the engagement. {field.state.value.length}/
								{PROJECT_DESCRIPTION_MAX} characters.
							</FieldDescription>
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
								value={field.state.value}
								disabled={isSubmitting}
								onBlur={field.handleBlur}
								onChange={(event) => {
									setSlugTouched(true);
									field.handleChange(event.target.value.toLowerCase());
								}}
							/>
							<FieldError errors={toFieldErrors(field.state.meta.errors)} />
							<FieldDescription>
								Unique inside this workspace. Use lowercase letters, numbers and
								hyphens.
							</FieldDescription>
						</Field>
					)}
				</form.Field>

				{error && (
					<p role="alert" className="text-sm text-danger">
						{error}
					</p>
				)}

				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						onPress={() => onOpenChange(false)}
						isDisabled={isSubmitting}
					>
						Cancel
					</Button>
					<Button type="submit" loading={isSubmitting}>
						{mode === "create" ? "Create project" : "Save changes"}
					</Button>
				</DialogFooter>
			</form>
		</Dialog>
	);
}
