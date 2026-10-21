/**
 * Organization logo control.
 *
 * Owns the file picker, local preview, upload progress, the presigned upload
 * call and the removal confirmation. Keeping it separate from the General card
 * means the card stays a layout and form, and a future surface can reuse the
 * same control.
 *
 * Used by: general-card.tsx.
 */

import { Button } from "@org/ui/components/button";
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@org/ui/components/dialog";
import { useMutation } from "@tanstack/react-query";
import { type ChangeEvent, useEffect, useRef, useState } from "react";

import { UserAvatar } from "#/components/user-avatar";
import { useAutoDismiss } from "#/hooks/use-auto-dismiss";
import { FILE_POLICIES, uploadFile, validateUploadFile } from "#/lib/upload";
import { beginOrganizationOperation } from "../switch-guard";
import { refreshActiveOrganization, useRemoveOrganizationLogo } from "./hooks";

type OrganizationLogoUploaderProps = {
	organizationId: string;
	organizationSlug: string;
	/** Display name, used for the initials fallback and the alt text. */
	name: string;
	logo?: string | null;
	/** Owners and admins can change the logo. Members see it read only. */
	canEdit: boolean;
	/** Called after the API has stored or cleared the logo. */
	onChanged: () => void | Promise<void>;
};

const policy = FILE_POLICIES["organization-logo"];

export function OrganizationLogoUploader({
	organizationId,
	organizationSlug,
	name,
	logo,
	canEdit,
	onChanged,
}: OrganizationLogoUploaderProps) {
	const inputRef = useRef<HTMLInputElement>(null);
	const [preview, setPreview] = useState<string | null>(null);
	const [progress, setProgress] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);
	const [removeOpen, setRemoveOpen] = useState(false);

	const upload = useMutation({
		mutationFn: (file: File) => {
			// A logo upload can take a while on a slow connection. Record it so
			// another tab cannot switch away mid upload.
			const operation = beginOrganizationOperation({
				organizationId,
				organizationSlug,
				reason: "Uploading a new organization logo",
			});

			return uploadFile({
				file,
				purpose: "organization-logo",
				organizationId,
				onProgress: setProgress,
			}).finally(() => operation.end());
		},
	});

	const removeLogo = useRemoveOrganizationLogo();

	useAutoDismiss(success, () => setSuccess(null));

	// Revoke the blob URL when the preview is replaced or the card unmounts,
	// otherwise it stays in memory for the lifetime of the tab.
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

		const problem = validateUploadFile(file, "organization-logo");
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
			onSuccess: async () => {
				try {
					// The API wrote the logo, so the browser has to refetch the
					// active organization before the sidebar shows it.
					await refreshActiveOrganization(organizationId);
					await onChanged();
					setPreview(null);
					setSuccess("Logo updated.");
				} catch (refreshError) {
					setPreview(null);
					setError(
						refreshError instanceof Error
							? refreshError.message
							: "The logo was saved but the page could not refresh.",
					);
				}
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

	async function handleRemove() {
		setError(null);
		setSuccess(null);

		const operation = beginOrganizationOperation({
			organizationId,
			organizationSlug,
			reason: "Removing the organization logo",
		});

		try {
			await removeLogo.mutateAsync(organizationSlug);
			await refreshActiveOrganization(organizationId);
			await onChanged();
			setRemoveOpen(false);
			setSuccess("Logo removed.");
		} catch (removeError) {
			setError(
				removeError instanceof Error
					? removeError.message
					: "Could not remove the logo.",
			);
		} finally {
			operation.end();
		}
	}

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-center">
				<UserAvatar
					src={preview ?? logo}
					name={name}
					size="xl"
					shape="square"
				/>

				<div className="flex flex-col items-start gap-2">
					<input
						ref={inputRef}
						type="file"
						accept={policy.accept}
						onChange={handleFileChange}
						disabled={!canEdit || upload.isPending || removeLogo.isPending}
						className="sr-only"
						aria-label="Choose an organization logo"
					/>

					{canEdit ? (
						<div className="flex flex-wrap items-center gap-2">
							<Button
								type="button"
								variant="outline"
								onPress={() => inputRef.current?.click()}
								loading={upload.isPending}
								isDisabled={removeLogo.isPending}
							>
								{logo ? "Change logo" : "Upload logo"}
							</Button>

							{logo && (
								<Button
									type="button"
									variant="outline"
									// The outline variant switches text to foreground on
									// hover. Keep the danger colour so the destructive
									// intent survives the interaction.
									className="text-danger hover:bg-danger-bg hover:text-danger"
									onPress={() => {
										removeLogo.reset();
										setRemoveOpen(true);
									}}
									isDisabled={upload.isPending}
								>
									Remove logo
								</Button>
							)}
						</div>
					) : (
						<p className="text-sm text-app-text-muted">
							Only owners and admins can change the logo.
						</p>
					)}

					<p className="text-xs text-app-text-muted">{policy.label}</p>
				</div>
			</div>

			{upload.isPending && (
				<div className="flex flex-col gap-1">
					<progress
						className="h-1 w-full accent-app-action"
						value={progress}
						max={100}
						aria-label="Logo upload progress"
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

			<Dialog
				isOpen={removeOpen}
				onOpenChange={(open) => {
					if (!open) {
						setRemoveOpen(false);
						removeLogo.reset();
					}
				}}
			>
				<DialogHeader>
					<DialogTitle>Remove logo</DialogTitle>
				</DialogHeader>
				<DialogDescription>
					The organization will fall back to its initials in the sidebar and
					everywhere else the logo appears.
				</DialogDescription>
				<DialogFooter>
					<Button
						variant="outline"
						onPress={() => setRemoveOpen(false)}
						isDisabled={removeLogo.isPending}
					>
						Cancel
					</Button>
					<Button
						variant="destructive"
						loading={removeLogo.isPending}
						onPress={handleRemove}
					>
						Remove logo
					</Button>
				</DialogFooter>
			</Dialog>
		</div>
	);
}
