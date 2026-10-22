/**
 * Project logo control.
 *
 * Owns the file picker, validation, preview, progress and the presigned upload
 * call. It does not save the project: the parent form owns that, so a logo
 * picked while creating a project is attached by the create request, and a
 * logo replaced while editing is attached by the same save as the name and
 * slug.
 *
 * A long upload is registered with the organization switch guard, because
 * switching workspace mid upload would send the object to the wrong tenant.
 *
 * Used by: project-dialog.tsx.
 */

import { Button } from "@org/ui/components/button";
import { useMutation } from "@tanstack/react-query";
import { type ChangeEvent, useEffect, useRef, useState } from "react";

import { UserAvatar } from "#/components/user-avatar";
import { beginOrganizationOperation } from "#/features/organization/switch-guard";
import { useAutoDismiss } from "#/hooks/use-auto-dismiss";
import { FILE_POLICIES, uploadFile, validateUploadFile } from "#/lib/upload";

type ProjectLogoUploaderProps = {
	organizationId: string;
	organizationSlug: string;
	/** Fallback name for the initials avatar and the alt text. */
	name: string;
	/** Current stored URL, or the URL picked in this form session. */
	value: string | null;
	/** Receives the uploaded URL, or null when the logo is cleared. */
	onChange: (value: string | null) => void;
	disabled?: boolean;
};

const policy = FILE_POLICIES["project-logo"];

export function ProjectLogoUploader({
	organizationId,
	organizationSlug,
	name,
	value,
	onChange,
	disabled = false,
}: ProjectLogoUploaderProps) {
	const inputRef = useRef<HTMLInputElement>(null);
	const [preview, setPreview] = useState<string | null>(null);
	const [progress, setProgress] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);

	const upload = useMutation({
		mutationFn: (file: File) => {
			const operation = beginOrganizationOperation({
				organizationId,
				organizationSlug,
				reason: "Uploading a project logo",
			});

			return uploadFile({
				file,
				purpose: "project-logo",
				organizationId,
				onProgress: setProgress,
			}).finally(() => operation.end());
		},
	});

	useAutoDismiss(success, () => setSuccess(null));

	// Revoke the blob URL when the preview is replaced or the form unmounts.
	useEffect(() => {
		return () => {
			if (preview) URL.revokeObjectURL(preview);
		};
	}, [preview]);

	function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.[0];

		// Reset so choosing the same file again still fires a change event.
		event.target.value = "";

		if (!file) return;

		const problem = validateUploadFile(file, "project-logo");
		if (problem) {
			setError(problem);
			setSuccess(null);
			return;
		}

		setError(null);
		setSuccess(null);
		setProgress(0);
		setPreview(URL.createObjectURL(file));

		upload.mutate(file, {
			onSuccess: (uploaded) => {
				onChange(uploaded.url);
				setPreview(null);
				setSuccess("Logo uploaded. Save the project to apply it.");
			},
			onError: (uploadError) => {
				setPreview(null);

				// An abort is a user action, not an error worth shouting about.
				if (uploadError instanceof DOMException) return;

				setError(
					uploadError instanceof Error
						? uploadError.message
						: "Could not upload the logo.",
				);
			},
		});
	}

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-center">
				<UserAvatar
					src={preview ?? value}
					name={name || "Project"}
					size="xl"
					shape="square"
				/>

				<div className="flex flex-col items-start gap-2">
					<input
						ref={inputRef}
						type="file"
						accept={policy.accept}
						onChange={handleFileChange}
						disabled={disabled || upload.isPending}
						className="sr-only"
						aria-label="Choose a project logo"
					/>
					<div className="flex flex-wrap items-center gap-2">
						<Button
							type="button"
							variant="outline"
							onPress={() => inputRef.current?.click()}
							loading={upload.isPending}
							isDisabled={disabled}
						>
							{value ? "Change logo" : "Upload logo"}
						</Button>
						{value && (
							<Button
								type="button"
								variant="outline"
								onPress={() => {
									onChange(null);
									setPreview(null);
									setSuccess("Logo will be removed when you save.");
								}}
								isDisabled={disabled || upload.isPending}
							>
								Remove logo
							</Button>
						)}
					</div>
					<p className="text-xs text-app-text-muted">{policy.label}</p>
				</div>
			</div>

			{upload.isPending && (
				<div className="flex flex-col gap-1">
					<progress
						className="h-1 w-full accent-app-action"
						value={progress}
						max={100}
						aria-label="Upload progress"
					/>
					<output className="text-xs text-app-text-muted">
						Uploading {progress}%
					</output>
				</div>
			)}

			{error && (
				<p role="alert" className="text-sm text-danger">
					{error}
				</p>
			)}

			{success && !error && (
				<output className="text-sm text-success">{success}</output>
			)}
		</div>
	);
}
