import { Button } from "@org/ui/components/button";
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@org/ui/components/dialog";
import { Label } from "@org/ui/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@org/ui/components/select";
import { Textarea } from "@org/ui/components/textarea";
import {
	AlertCircle,
	CheckCircle2,
	CheckIcon,
	SendIcon,
	XCircle,
	XIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { assignableInvitationRoles } from "#/features/organization/permissions";
import { beginOrganizationOperation } from "#/features/organization/switch-guard";
import type { InvitationBulkResult } from "./api";
import { useBulkInvite } from "./hooks";
import { MAX_BULK_INVITES, parseEmailInput } from "./schema";

/**
 * Bulk invitation dialog.
 *
 * Why a textarea instead of a repeater: people invite from a spreadsheet or a
 * thread, so pasting a list is faster than adding one row at a time. Parsing is
 * live, so an invalid line or a duplicate is visible before sending, and the
 * API's per address outcomes are shown in place. Successful addresses leave the
 * box, failures stay for correction.
 *
 * Used by: the Members and Invitations pages.
 */

type InviteMembersDialogProps = {
	organizationId: string;
	orgSlug: string;
	viewerRole: string;
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	/** Prefill from "Invite again" on a canceled or rejected invitation. */
	initialEmails?: string;
	/** Keep the original invitation's role when re-inviting. */
	initialRole?: "member" | "admin";
};

/** Group outcomes so the summary is readable before the detail list. */
function summarize(results: InvitationBulkResult[]) {
	return {
		invited: results.filter(
			(result) => result.status === "invited" || result.status === "resent",
		).length,
		problems: results.filter(
			(result) => result.status === "failed" || result.status === "skipped",
		).length,
	};
}

export function InviteMembersDialog({
	organizationId,
	orgSlug,
	viewerRole,
	isOpen,
	onOpenChange,
	initialEmails,
	initialRole,
}: InviteMembersDialogProps) {
	const [input, setInput] = useState(initialEmails ?? "");
	const [role, setRole] = useState<"member" | "admin">("member");
	const [results, setResults] = useState<InvitationBulkResult[] | null>(null);
	const [error, setError] = useState<string | null>(null);

	// Memoised so the reset effect below does not fire on every render.
	const roles = useMemo(
		() => assignableInvitationRoles(viewerRole),
		[viewerRole],
	);
	const mutation = useBulkInvite(orgSlug);

	const parsed = useMemo(() => parseEmailInput(input), [input]);
	const tooMany = parsed.valid.length > MAX_BULK_INVITES;
	const canSubmit =
		parsed.valid.length > 0 &&
		!tooMany &&
		!mutation.isPending &&
		results === null;

	// Reset each time the dialog opens, and carry a prefilled address across.
	useEffect(() => {
		if (!isOpen) return;

		setInput(initialEmails ?? "");
		setRole(
			initialRole && roles.includes(initialRole)
				? initialRole
				: (roles[0] ?? "member"),
		);
		setResults(null);
		setError(null);
	}, [isOpen, initialEmails, initialRole, roles]);

	async function handleSubmit() {
		if (!canSubmit) return;

		setError(null);

		// Sending several invitations is long enough to matter if the user
		// switches workspace in another tab. The switch guard blocks leaving
		// this workspace until the batch finishes.
		const operation = beginOrganizationOperation({
			organizationId,
			organizationSlug: orgSlug,
			reason: `Sending ${parsed.valid.length} invitation${
				parsed.valid.length === 1 ? "" : "s"
			}`,
		});

		try {
			const data = await mutation.mutateAsync({
				emails: parsed.valid,
				role,
			});

			setResults(data.results);

			const summary = summarize(data.results);
			if (summary.invited > 0) {
				toast.success(
					`${summary.invited} invitation${summary.invited === 1 ? "" : "s"} sent.`,
				);
			}

			// Keep what still needs attention. Invalid lines were never sent;
			// failed and skipped rows need a correction or a different action.
			const retry = data.results
				.filter(
					(result) => result.status === "failed" || result.status === "skipped",
				)
				.map((result) => result.key);
			const invalid = parsed.entries
				.filter((entry) => entry.state !== "valid")
				.map((entry) => entry.email);

			setInput([...retry, ...invalid].join("\n"));
		} catch (err) {
			setError(
				err instanceof Error ? err.message : "Could not send the invitations.",
			);
		} finally {
			operation.end();
		}
	}

	function handleOpenChange(open: boolean) {
		if (!open) {
			setResults(null);
			setError(null);
		}
		onOpenChange(open);
	}

	return (
		<Dialog
			isOpen={isOpen}
			onOpenChange={handleOpenChange}
			// Keep the dialog inside the viewport on short screens, even with a
			// long address list and a results summary.
			className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
		>
			<DialogHeader>
				<DialogTitle>Invite members</DialogTitle>
			</DialogHeader>
			<DialogDescription>
				Paste up to {MAX_BULK_INVITES} email addresses. Each person receives a
				single use invitation link. Invitations expire after seven days.
			</DialogDescription>

			<div className="flex flex-col gap-5">
				<div className="flex flex-col gap-2">
					<Label htmlFor="invite-emails">Email addresses</Label>
					<Textarea
						id="invite-emails"
						value={input}
						onChange={(event) => {
							setInput(event.target.value);

							// Editing after a send is a new attempt. Drop the old
							// summary so the send button comes back.
							if (results) setResults(null);
						}}
						placeholder={"ayesha@studio.com\nsam@studio.com"}
						rows={5}
						aria-describedby="invite-emails-hint"
						disabled={mutation.isPending}
						// The textarea grows with its content by default. Cap it
						// and scroll internally so a pasted list cannot stretch
						// the dialog.
						className="max-h-48 overflow-y-auto"
					/>
					<p id="invite-emails-hint" className="text-xs text-app-text-muted">
						One per line, or separated by commas.{" "}
						{parsed.valid.length > 0 && (
							<span className="text-app-text">
								{parsed.valid.length} ready to invite
								{parsed.duplicateCount > 0
									? `, ${parsed.duplicateCount} duplicate`
									: ""}
								{parsed.invalidCount > 0
									? `, ${parsed.invalidCount} invalid`
									: ""}
								.
							</span>
						)}
					</p>
					{tooMany && (
						<p role="alert" className="text-sm text-danger">
							Send at most {MAX_BULK_INVITES} addresses at a time. Split the
							list into smaller batches.
						</p>
					)}
				</div>

				<div className="flex flex-col gap-2">
					<Label htmlFor="invite-role">Role</Label>
					<Select
						aria-label="Invitation role"
						// The shared Select defaults to w-fit, which shrinks the
						// trigger to its current value. The role field should
						// span the dialog like the email input.
						className="w-full"
						selectedKey={role}
						onSelectionChange={(key) => {
							if (key === "member" || key === "admin") setRole(key);
						}}
						isDisabled={mutation.isPending || roles.length === 1}
					>
						<SelectTrigger id="invite-role">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem id="member">Member</SelectItem>
							{roles.includes("admin") && (
								<SelectItem id="admin">Admin</SelectItem>
							)}
						</SelectContent>
					</Select>
					<p className="text-xs text-app-text-muted">
						{roles.includes("admin")
							? "Admins can manage members and workspace settings."
							: "Only an owner can invite someone as an admin."}
					</p>
				</div>

				{error && (
					<p role="alert" className="text-sm text-danger">
						{error}
					</p>
				)}

				{results && (
					<div className="flex flex-col gap-3">
						<p aria-live="polite" className="text-sm font-medium text-app-text">
							{summarize(results).invited} invited
							{summarize(results).problems > 0
								? `, ${summarize(results).problems} need attention`
								: ""}
							.
						</p>
						<ul className="flex max-h-56 flex-col gap-2 overflow-y-auto">
							{results.map((result) => (
								<ResultRow
									key={`${result.key}-${result.status}`}
									result={result}
								/>
							))}
						</ul>
						<p className="text-xs text-app-text-muted">
							Delivery is queued. If an email does not arrive, resend it from
							the Invitations page.
						</p>
					</div>
				)}
			</div>

			<DialogFooter>
				{results ? (
					<Button onPress={() => handleOpenChange(false)}>
						<CheckIcon aria-hidden />
						Done
					</Button>
				) : (
					<>
						<Button
							variant="outline"
							onPress={() => handleOpenChange(false)}
							isDisabled={mutation.isPending}
						>
							<XIcon aria-hidden />
							Cancel
						</Button>
						<Button
							loading={mutation.isPending}
							isDisabled={!canSubmit}
							onPress={handleSubmit}
						>
							<SendIcon aria-hidden />
							{parsed.valid.length > 1
								? `Send ${parsed.valid.length} invitations`
								: "Send invitation"}
						</Button>
					</>
				)}
			</DialogFooter>
		</Dialog>
	);
}

/** One outcome line, with an icon that matches the status family. */
function ResultRow({ result }: { result: InvitationBulkResult }) {
	const invited = result.status === "invited" || result.status === "resent";
	const skipped = result.status === "skipped";

	return (
		<li className="flex items-start gap-2 text-sm">
			{invited ? (
				<CheckCircle2
					className="mt-0.5 size-4 shrink-0 text-success"
					aria-hidden
				/>
			) : skipped ? (
				<AlertCircle
					className="mt-0.5 size-4 shrink-0 text-warning"
					aria-hidden
				/>
			) : (
				<XCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
			)}
			<span className="min-w-0">
				<span className="block truncate font-medium text-app-text">
					{result.label}
				</span>
				<span className="block text-xs text-app-text-muted">
					{result.message}
				</span>
			</span>
		</li>
	);
}
