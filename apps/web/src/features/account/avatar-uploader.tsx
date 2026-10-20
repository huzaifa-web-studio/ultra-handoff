/**
 * Avatar upload control.
 *
 * Why a dedicated component: it owns the file picker, client validation,
 * preview, progress and the upload call. Any future surface that changes an
 * avatar can reuse it without repeating the presigned upload dance.
 *
 * Used by: src/features/account/profile-card.tsx.
 */

import { Button } from "@org/ui/components/button";
import { useMutation } from "@tanstack/react-query";
import { type ChangeEvent, useEffect, useRef, useState } from "react";

import { UserAvatar } from "#/components/user-avatar";
import { useAutoDismiss } from "#/hooks/use-auto-dismiss";
import { FILE_POLICIES, uploadFile, validateUploadFile } from "#/lib/upload";

type AvatarUploaderProps = {
	image?: string | null;
	name: string;
	/** Called after the API has stored the new image on the user. */
	onUploaded: () => void | Promise<void>;
};

const policy = FILE_POLICIES.avatar;

export function AvatarUploader({
	image,
	name,
	onUploaded,
}: AvatarUploaderProps) {
	const inputRef = useRef<HTMLInputElement>(null);
	const [progress, setProgress] = useState(0);
	const [preview, setPreview] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);

	const mutation = useMutation({
		mutationFn: (file: File) =>
			uploadFile({
				file,
				purpose: "avatar",
				onProgress: setProgress,
			}),
	});

	useAutoDismiss(success, () => setSuccess(null));

	// Revoke the object URL when the preview is replaced or the card unmounts,
	// otherwise the blob stays in memory for the lifetime of the tab.
	useEffect(() => {
		return () => {
			if (preview) URL.revokeObjectURL(preview);
		};
	}, [preview]);

	function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.[0];

		// Reset the input so selecting the same file again still fires change.
		event.target.value = "";

		if (!file) return;

		const problem = validateUploadFile(file, "avatar");
		if (problem) {
			setError(problem);
			setSuccess(null);
			return;
		}

		setError(null);
		setSuccess(null);
		setProgress(0);
		setPreview(URL.createObjectURL(file));

		mutation.mutate(file, {
			onSuccess: async () => {
				// Keep the local preview visible until the session has the new
				// image, otherwise the old avatar flashes for a moment.
				await onUploaded();
				setPreview(null);
				setSuccess("Avatar updated.");
			},
			onError: (uploadError) => {
				// Drop the failed preview so the current avatar is visible again.
				setPreview(null);

				// An abort is a user action, not something to shout about.
				if (uploadError instanceof DOMException) return;

				setError(
					uploadError instanceof Error
						? uploadError.message
						: "Could not upload the image.",
				);
			},
		});
	}

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-center">
				<UserAvatar src={preview ?? image} name={name} size="xl" />

				<div className="flex flex-col items-start gap-2">
					<input
						ref={inputRef}
						type="file"
						accept={policy.accept}
						onChange={handleFileChange}
						disabled={mutation.isPending}
						className="sr-only"
						aria-label="Choose a profile photo"
					/>
					<Button
						type="button"
						variant="outline"
						onPress={() => inputRef.current?.click()}
						loading={mutation.isPending}
					>
						Change photo
					</Button>
					<p className="text-xs text-app-text-muted">{policy.label}</p>
				</div>
			</div>

			{mutation.isPending && (
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
				<output className="block text-sm text-success">{success}</output>
			)}
		</div>
	);
}
