import { Button } from "@org/ui/components/button";
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@org/ui/components/dialog";
import {
	AlertCircle,
	CheckCircle2,
	CheckIcon,
	Trash2Icon,
	XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { canManageTarget } from "#/features/organization/permissions";
import { beginOrganizationOperation } from "#/features/organization/switch-guard";
import type { BulkItemResult, MemberRow } from "./api";
import { useBulkRemoveMembers } from "./hooks";

/**
 * Confirm bulk member removal.
 *
 * Why it pre-sorts blocked rows: the server refuses self removal, the last
 * owner, and owner or admin targets for an admin. Showing those reasons here
 * means the confirmation never promises an action that can only fail, and the
 * request only carries the rows that can actually be removed.
 *
 * Used by: routes/_app/$orgSlug.settings.members.tsx.
 */

type RemoveMembersDialogProps = {
	organizationId: string;
	orgSlug: string;
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	members: MemberRow[];
	viewerRole: string;
	ownerCount: number;
	/** Clear the table selection after a successful removal. */
	onRemoved: () => void;
};

type Blocked = { member: MemberRow; reason: string };

export function RemoveMembersDialog({
	organizationId,
	orgSlug,
	isOpen,
	onOpenChange,
	members,
	viewerRole,
	ownerCount,
	onRemoved,
}: RemoveMembersDialogProps) {
	const [results, setResults] = useState<BulkItemResult[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const mutation = useBulkRemoveMembers(orgSlug);

	const { removable, blocked } = useMemo(() => {
		const removableRows: MemberRow[] = [];
		const blockedRows: Blocked[] = [];

		for (const member of members) {
			if (member.isSelf) {
				blockedRows.push({
					member,
					reason: "You cannot remove yourself. Use Leave organization.",
				});
				continue;
			}

			if (!canManageTarget(viewerRole, member.role)) {
				blockedRows.push({
					member,
					reason: "Only an owner can remove an admin or an owner.",
				});
				continue;
			}

			if (member.isOwner && ownerCount <= 1) {
				blockedRows.push({
					member,
					reason: "A workspace needs at least one owner.",
				});
				continue;
			}

			removableRows.push(member);
		}

		return { removable: removableRows, blocked: blockedRows };
	}, [members, viewerRole, ownerCount]);

	async function handleRemove() {
		if (removable.length === 0 || mutation.isPending) return;

		setError(null);

		const operation = beginOrganizationOperation({
			organizationId,
			organizationSlug: orgSlug,
			reason: `Removing ${removable.length} member${
				removable.length === 1 ? "" : "s"
			}`,
		});

		try {
			const data = await mutation.mutateAsync(
				removable.map((member) => member.id),
			);

			setResults(data.results);

			const removed = data.results.filter(
				(result) => result.status === "removed",
			).length;

			if (removed > 0) {
				toast.success(`${removed} member${removed === 1 ? "" : "s"} removed.`);
			}
		} catch (err) {
			setError(
				err instanceof Error ? err.message : "Could not remove those members.",
			);
		} finally {
			operation.end();
		}
	}

	function close() {
		onOpenChange(false);
		setError(null);

		if (results) {
			setResults(null);
			onRemoved();
		}
	}

	return (
		<Dialog
			isOpen={isOpen}
			onOpenChange={(open) => {
				if (!open) close();
			}}
		>
			<DialogHeader>
				<DialogTitle>
					{removable.length === 0
						? "No members can be removed"
						: `Remove ${removable.length} member${
								removable.length === 1 ? "" : "s"
							}?`}
				</DialogTitle>
			</DialogHeader>
			<DialogDescription>
				Removing someone ends their access to this workspace immediately. Their
				work stays with the organization, and they can be invited back later.
			</DialogDescription>

			<div className="flex flex-col gap-4">
				{removable.length > 0 && (
					<ul className="flex max-h-48 flex-col gap-1 overflow-y-auto text-sm">
						{removable.slice(0, 8).map((member) => (
							<li key={member.id} className="truncate text-app-text">
								{member.name}{" "}
								<span className="text-app-text-muted">({member.email})</span>
							</li>
						))}
						{removable.length > 8 && (
							<li className="text-app-text-muted">
								and {removable.length - 8} more
							</li>
						)}
					</ul>
				)}

				{blocked.length > 0 && (
					<div className="flex flex-col gap-2 border border-warning bg-warning-bg p-3">
						<p className="text-xs font-semibold tracking-wide text-warning uppercase">
							Will be skipped
						</p>
						<ul className="flex flex-col gap-1 text-sm text-warning">
							{blocked.map(({ member, reason }) => (
								<li key={member.id}>
									{member.name}: {reason}
								</li>
							))}
						</ul>
					</div>
				)}

				{error && (
					<p role="alert" className="text-sm text-danger">
						{error}
					</p>
				)}

				{results && (
					<div className="flex flex-col gap-2">
						<ul className="flex max-h-48 flex-col gap-2 overflow-y-auto">
							{results.map((result) => (
								<li key={result.key} className="flex items-start gap-2 text-sm">
									{result.status === "removed" ? (
										<CheckCircle2
											className="mt-0.5 size-4 shrink-0 text-success"
											aria-hidden
										/>
									) : result.status === "skipped" ? (
										<AlertCircle
											className="mt-0.5 size-4 shrink-0 text-warning"
											aria-hidden
										/>
									) : (
										<XCircle
											className="mt-0.5 size-4 shrink-0 text-danger"
											aria-hidden
										/>
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
							))}
						</ul>
					</div>
				)}
			</div>

			<DialogFooter>
				{results ? (
					<Button onPress={close}>
						<CheckIcon aria-hidden />
						Done
					</Button>
				) : (
					<>
						<Button
							variant="outline"
							onPress={close}
							isDisabled={mutation.isPending}
						>
							Cancel
						</Button>
						<Button
							variant="destructive"
							loading={mutation.isPending}
							isDisabled={removable.length === 0}
							onPress={handleRemove}
						>
							<Trash2Icon aria-hidden />
							Remove
						</Button>
					</>
				)}
			</DialogFooter>
		</Dialog>
	);
}
