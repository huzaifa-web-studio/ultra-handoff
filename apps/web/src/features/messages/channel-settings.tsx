"use client";

/**
 * Channel settings.
 *
 * One panel for everything a member or owner can do: rename, set the topic,
 * change visibility, manage members, mute, leave, and archive. Sections are
 * hidden when the viewer cannot use them, but the server is the authority on
 * every action, so hiding is only a convenience.
 *
 * Destructive actions use a two step button. The first click asks, the second
 * performs, which avoids a browser confirm dialog in the middle of the app.
 *
 * Used by: features/messages/conversation-view.tsx.
 */

import { Avatar, AvatarFallback, AvatarImage } from "@org/ui/components/avatar";
import { Button } from "@org/ui/components/button";
import {
	Dialog,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@org/ui/components/dialog";
import { Input } from "@org/ui/components/input";
import { MultiSelect } from "@org/ui/components/multi-select";
import { Textarea } from "@org/ui/components/textarea";
import { useNavigate } from "@tanstack/react-router";
import {
	BellIcon,
	BellOffIcon,
	Loader2Icon,
	UserMinusIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import type { ChannelSummary } from "./api";
import {
	useAddChannelMembers,
	useContacts,
	useLeaveChannel,
	useRemoveChannelMember,
	useSetChannelArchived,
	useSetChannelMemberRole,
	useSetChannelMuted,
	useUpdateChannel,
} from "./hooks";

/** Initials for an avatar fallback. */
function initials(name: string): string {
	const parts = name.trim().split(/\s+/).slice(0, 2);

	return parts.map((part) => part.charAt(0).toUpperCase()).join("") || "?";
}

function message(error: unknown, fallback: string): string {
	return error instanceof Error && error.message.length > 0
		? error.message
		: fallback;
}

type PendingAction = "leave" | "archive" | null;

export function ChannelSettingsDialog({
	orgSlug,
	conversation,
	viewerId,
	isOpen,
	onOpenChange,
}: {
	orgSlug: string;
	conversation: ChannelSummary;
	viewerId: string;
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const navigate = useNavigate();
	const [title, setTitle] = useState(conversation.title ?? "");
	const [description, setDescription] = useState(
		conversation.description ?? "",
	);
	const [visibility, setVisibility] = useState<"public" | "private">(
		conversation.visibility,
	);
	const [newMembers, setNewMembers] = useState<string[]>([]);
	const [pending, setPending] = useState<PendingAction>(null);
	const [error, setError] = useState<string | null>(null);

	const contacts = useContacts(orgSlug, "", isOpen && conversation.canManage);
	const update = useUpdateChannel(orgSlug, conversation.id);
	const addMembers = useAddChannelMembers(orgSlug, conversation.id);
	const removeMember = useRemoveChannelMember(orgSlug, conversation.id);
	const setRole = useSetChannelMemberRole(orgSlug, conversation.id);
	const setMuted = useSetChannelMuted(orgSlug, conversation.id);
	const setArchived = useSetChannelArchived(orgSlug, conversation.id);
	const leave = useLeaveChannel(orgSlug);

	// Reset the form when the channel changes or the server reports new values.
	// The dialog is keyed by channel id in the parent, so a switch remounts it.
	useEffect(() => {
		setTitle(conversation.title ?? "");
		setDescription(conversation.description ?? "");
		setVisibility(conversation.visibility);
		setNewMembers([]);
		setPending(null);
		setError(null);
	}, [conversation.title, conversation.description, conversation.visibility]);

	const archived = conversation.archivedAt !== null;
	const memberIds = new Set(
		conversation.participants.map((participant) => participant.userId),
	);
	const memberOptions = (contacts.data?.contacts ?? [])
		.filter((contact) => !memberIds.has(contact.userId))
		.map((contact) => ({
			value: contact.userId,
			label: contact.name,
			description: contact.role,
		}));

	async function run(action: () => Promise<unknown>, fallback: string) {
		setError(null);

		try {
			await action();
		} catch (actionError) {
			setError(message(actionError, fallback));
		}
	}

	async function saveSettings() {
		await run(
			() =>
				update.mutateAsync({
					title: title.trim(),
					description: description.trim() || null,
					visibility,
				}),
			"Could not save the channel.",
		);
	}

	async function addPeople() {
		if (newMembers.length === 0) return;

		await run(async () => {
			await addMembers.mutateAsync(newMembers);
			setNewMembers([]);
		}, "Could not add those people.");
	}

	async function remove(userId: string) {
		await run(
			() => removeMember.mutateAsync(userId),
			"Could not remove that person.",
		);
	}

	async function changeRole(userId: string, role: "owner" | "member") {
		await run(
			() => setRole.mutateAsync({ userId, role }),
			"Could not change that role.",
		);
	}

	async function toggleMute() {
		await run(
			() => setMuted.mutateAsync(!conversation.muted),
			"Could not change the notification setting.",
		);
	}

	async function leaveChannel() {
		await run(async () => {
			await leave.mutateAsync(conversation.id);
			onOpenChange(false);
			void navigate({
				to: "/$orgSlug/messages",
				params: { orgSlug },
			});
		}, "Could not leave the channel.");
	}

	async function archiveChannel() {
		await run(
			() => setArchived.mutateAsync(true),
			"Could not archive the channel.",
		);
		setPending(null);
	}

	async function restoreChannel() {
		await run(
			() => setArchived.mutateAsync(false),
			"Could not restore the channel.",
		);
	}

	return (
		<Dialog
			isOpen={isOpen}
			onOpenChange={(next) => {
				onOpenChange(next);

				if (!next) setError(null);
			}}
			className="max-h-[85vh] overflow-y-auto sm:max-w-lg"
		>
			<DialogHeader>
				<DialogTitle>{conversation.title ?? "Channel"}</DialogTitle>
				<DialogDescription>
					{archived
						? "This channel is archived. Restore it to post again."
						: "Manage who is in this channel and how it appears."}
				</DialogDescription>
			</DialogHeader>

			{error && (
				<p role="alert" className="text-sm text-danger">
					{error}
				</p>
			)}

			<div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
				{conversation.canManage && !archived && (
					<section className="flex flex-col gap-3">
						<h3 className="text-sm font-semibold text-app-text">Settings</h3>

						<label
							htmlFor="channel-settings-name"
							className="flex flex-col gap-1 text-sm"
						>
							<span className="font-medium text-app-text">Name</span>
							<Input
								id="channel-settings-name"
								value={title}
								onChange={(event) => setTitle(event.target.value)}
								maxLength={80}
							/>
						</label>

						<label
							htmlFor="channel-settings-description"
							className="flex flex-col gap-1 text-sm"
						>
							<span className="font-medium text-app-text">Topic</span>
							<Textarea
								id="channel-settings-description"
								value={description}
								onChange={(event) => setDescription(event.target.value)}
								maxLength={280}
								rows={2}
							/>
						</label>

						<label className="flex flex-col gap-1 text-sm">
							<span className="font-medium text-app-text">Who can join</span>
							<select
								value={visibility}
								onChange={(event) =>
									setVisibility(
										event.target.value === "public" ? "public" : "private",
									)
								}
								className="h-9 border border-app-border bg-app-panel px-2 text-sm text-app-text"
							>
								<option value="public">Public</option>
								<option value="private">Private</option>
							</select>
						</label>

						<div className="flex justify-end">
							<Button
								size="sm"
								onPress={() => void saveSettings()}
								isDisabled={update.isPending}
							>
								{update.isPending && (
									<Loader2Icon aria-hidden className="animate-spin" />
								)}
								Save settings
							</Button>
						</div>
					</section>
				)}

				<section className="flex flex-col gap-2">
					<h3 className="text-sm font-semibold text-app-text">
						Members ({conversation.memberCount})
					</h3>

					{conversation.canManage && !archived && (
						<div className="flex items-end gap-2">
							<div className="flex-1">
								<MultiSelect
									options={memberOptions}
									selected={newMembers}
									onSelectedChange={setNewMembers}
									label="Add members"
									placeholder="Add people"
									searchPlaceholder="Search name or email"
									emptyMessage="No one matches that search."
									disabled={addMembers.isPending || contacts.isPending}
								/>
							</div>
							<Button
								size="sm"
								onPress={() => void addPeople()}
								isDisabled={newMembers.length === 0 || addMembers.isPending}
							>
								Add
							</Button>
						</div>
					)}

					<ul className="flex flex-col border border-app-border">
						{conversation.participants.map((participant) => (
							<li
								key={participant.userId}
								className="flex items-center gap-2 border-b border-app-border px-2 py-1.5 last:border-b-0"
							>
								<Avatar size="sm">
									{participant.image && (
										<AvatarImage src={participant.image} alt="" />
									)}
									<AvatarFallback>{initials(participant.name)}</AvatarFallback>
								</Avatar>
								<span className="min-w-0 flex-1">
									<span className="block truncate text-sm text-app-text">
										{participant.name}
									</span>
									<span className="block text-xs text-app-text-muted">
										{participant.role === "owner" ? "Owner" : "Member"}
									</span>
								</span>

								{participant.userId === viewerId ? (
									<span className="text-xs text-app-text-muted">You</span>
								) : (
									conversation.canManage &&
									!archived && (
										<>
											<Button
												size="sm"
												variant="ghost"
												onPress={() =>
													void changeRole(
														participant.userId,
														participant.role === "owner" ? "member" : "owner",
													)
												}
												isDisabled={setRole.isPending}
											>
												{participant.role === "owner"
													? "Make member"
													: "Make owner"}
											</Button>
											<Button
												size="icon-sm"
												variant="ghost"
												aria-label={`Remove ${participant.name}`}
												onPress={() => void remove(participant.userId)}
												isDisabled={removeMember.isPending}
											>
												<UserMinusIcon aria-hidden />
											</Button>
										</>
									)
								)}
							</li>
						))}
					</ul>
				</section>

				<section className="flex flex-col gap-2">
					<h3 className="text-sm font-semibold text-app-text">Notifications</h3>
					<Button
						variant="outline"
						size="sm"
						onPress={() => void toggleMute()}
						isDisabled={setMuted.isPending}
						className="justify-start"
					>
						{conversation.muted ? (
							<BellIcon aria-hidden />
						) : (
							<BellOffIcon aria-hidden />
						)}
						{conversation.muted ? "Unmute channel" : "Mute channel"}
					</Button>
					<p className="text-xs text-app-text-muted">
						A muted channel still shows unread, but sends no bell or push.
					</p>
				</section>

				<section className="flex flex-col gap-2">
					<h3 className="text-sm font-semibold text-app-text">Danger zone</h3>

					{conversation.canManage &&
						(archived ? (
							<Button
								variant="outline"
								size="sm"
								onPress={() => void restoreChannel()}
								isDisabled={setArchived.isPending}
								className="justify-start"
							>
								Restore channel
							</Button>
						) : (
							<Button
								variant="outline"
								size="sm"
								onPress={() => {
									if (pending === "archive") {
										void archiveChannel();
									} else {
										setPending("archive");
									}
								}}
								isDisabled={setArchived.isPending}
								className="justify-start"
							>
								{pending === "archive"
									? "Click again to archive"
									: "Archive channel"}
							</Button>
						))}

					<Button
						variant="outline"
						size="sm"
						onPress={() => {
							if (pending === "leave") {
								void leaveChannel();
							} else {
								setPending("leave");
							}
						}}
						isDisabled={leave.isPending}
						className="justify-start"
					>
						{pending === "leave" ? "Click again to leave" : "Leave channel"}
					</Button>
				</section>
			</div>

			<div className="flex justify-end">
				<Button variant="ghost" onPress={() => onOpenChange(false)}>
					Close
				</Button>
			</div>
		</Dialog>
	);
}
