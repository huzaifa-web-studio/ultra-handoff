"use client";

/**
 * The channel dialog.
 *
 * Two jobs in one surface: create a channel, or find a public one to join.
 * ClickUp puts both behind the same "add" action, and keeping them together
 * means the rail needs one button instead of two.
 *
 * Member picking reuses the workspace contact search. The list is workspace
 * members only, which matches the server rule that a channel cannot hold an
 * outsider.
 *
 * Used by: components/app-sidebar/nav-messages.tsx.
 */

import { Button } from "@org/ui/components/button";
import {
	Dialog,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@org/ui/components/dialog";
import { Input } from "@org/ui/components/input";
import { MultiSelect } from "@org/ui/components/multi-select";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@org/ui/components/tabs";
import { Textarea } from "@org/ui/components/textarea";
import { useNavigate } from "@tanstack/react-router";
import { HashIcon, Loader2Icon, LockIcon, SearchIcon } from "lucide-react";
import { useState } from "react";

import { useDebouncedValue } from "#/hooks/use-debounced-value";
import {
	useChannelBrowse,
	useContacts,
	useCreateChannel,
	useJoinChannel,
} from "./hooks";

/** Initials for an avatar fallback. */
function errorMessage(error: unknown, fallback: string): string {
	return error instanceof Error && error.message.length > 0
		? error.message
		: fallback;
}

export function ChannelDialog({
	orgSlug,
	isOpen,
	onOpenChange,
}: {
	orgSlug: string;
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const navigate = useNavigate();
	const [tab, setTab] = useState<"create" | "browse">("create");
	const [title, setTitle] = useState("");
	const [description, setDescription] = useState("");
	const [visibility, setVisibility] = useState<"public" | "private">("public");
	const [memberIds, setMemberIds] = useState<string[]>([]);
	const [search, setSearch] = useState("");
	const [error, setError] = useState<string | null>(null);
	const debounced = useDebouncedValue(search, 200);

	const contacts = useContacts(orgSlug, "", isOpen && tab === "create");
	const browse = useChannelBrowse(
		orgSlug,
		debounced,
		isOpen && tab === "browse",
	);
	const create = useCreateChannel(orgSlug);
	const join = useJoinChannel(orgSlug);

	function openChannel(conversationId: string) {
		onOpenChange(false);
		void navigate({
			to: "/$orgSlug/messages/$conversationId",
			params: { orgSlug, conversationId },
		});
	}

	function reset() {
		setTitle("");
		setDescription("");
		setVisibility("public");
		setMemberIds([]);
		setSearch("");
		setError(null);
		setTab("create");
	}

	async function submitCreate() {
		setError(null);

		if (title.trim().length === 0) {
			setError("Give the channel a name.");
			return;
		}

		try {
			const result = await create.mutateAsync({
				title: title.trim(),
				description: description.trim() || null,
				visibility,
				memberIds,
			});

			reset();
			openChannel(result.conversation.id);
		} catch (createError) {
			setError(errorMessage(createError, "Could not create the channel."));
		}
	}

	async function joinChannel(conversationId: string, joined: boolean) {
		setError(null);

		if (joined) {
			openChannel(conversationId);
			return;
		}

		try {
			const result = await join.mutateAsync(conversationId);

			reset();
			openChannel(result.conversation.id);
		} catch (joinError) {
			setError(errorMessage(joinError, "Could not join the channel."));
		}
	}

	const memberOptions = (contacts.data?.contacts ?? []).map((contact) => ({
		value: contact.userId,
		label: contact.name,
		description: contact.role,
	}));
	const browseRows = browse.data?.pages.flatMap((page) => page.channels) ?? [];

	return (
		<Dialog
			isOpen={isOpen}
			onOpenChange={(next) => {
				onOpenChange(next);

				if (!next) reset();
			}}
			className="max-h-[85vh] overflow-y-auto sm:max-w-lg"
		>
			<DialogHeader>
				<DialogTitle>Channels</DialogTitle>
				<DialogDescription>
					Create a room for a topic, or join a public one in this workspace.
				</DialogDescription>
			</DialogHeader>

			{error && (
				<p role="alert" className="text-sm text-danger">
					{error}
				</p>
			)}

			<Tabs
				selectedKey={tab}
				onSelectionChange={(key) => {
					setTab(key === "browse" ? "browse" : "create");
					setError(null);
				}}
			>
				<TabsList variant="line" aria-label="Channel actions">
					<TabsTrigger id="create">Create</TabsTrigger>
					<TabsTrigger id="browse">Browse</TabsTrigger>
				</TabsList>

				<TabsContent id="create" className="flex flex-col gap-3 pt-2">
					<label
						htmlFor="channel-create-name"
						className="flex flex-col gap-1 text-sm"
					>
						<span className="font-medium text-app-text">Name</span>
						<Input
							id="channel-create-name"
							value={title}
							onChange={(event) => {
								setTitle(event.target.value);
								setError(null);
							}}
							placeholder="design-review"
							maxLength={80}
							autoFocus
						/>
					</label>

					<label
						htmlFor="channel-create-description"
						className="flex flex-col gap-1 text-sm"
					>
						<span className="font-medium text-app-text">Topic (optional)</span>
						<Textarea
							id="channel-create-description"
							value={description}
							onChange={(event) => {
								setDescription(event.target.value);
								setError(null);
							}}
							placeholder="What this channel is for"
							maxLength={280}
							rows={2}
						/>
					</label>

					<fieldset className="flex flex-col gap-2">
						<legend className="text-sm font-medium text-app-text">
							Who can join
						</legend>
						<div className="flex flex-col gap-2 sm:flex-row">
							<label className="flex flex-1 cursor-pointer items-start gap-2 border border-app-border p-2 text-sm">
								<input
									type="radio"
									name="channel-visibility"
									value="public"
									checked={visibility === "public"}
									onChange={() => setVisibility("public")}
									className="mt-0.5"
								/>
								<span>
									<span className="flex items-center gap-1 font-medium text-app-text">
										<HashIcon aria-hidden className="size-3.5" />
										Public
									</span>
									<span className="block text-xs text-app-text-muted">
										Anyone in the workspace can find and join.
									</span>
								</span>
							</label>
							<label className="flex flex-1 cursor-pointer items-start gap-2 border border-app-border p-2 text-sm">
								<input
									type="radio"
									name="channel-visibility"
									value="private"
									checked={visibility === "private"}
									onChange={() => setVisibility("private")}
									className="mt-0.5"
								/>
								<span>
									<span className="flex items-center gap-1 font-medium text-app-text">
										<LockIcon aria-hidden className="size-3.5" />
										Private
									</span>
									<span className="block text-xs text-app-text-muted">
										Only people you add can see it.
									</span>
								</span>
							</label>
						</div>
					</fieldset>

					<div className="flex flex-col gap-1 text-sm">
						<span className="font-medium text-app-text">
							Members (optional)
						</span>
						<MultiSelect
							options={memberOptions}
							selected={memberIds}
							onSelectedChange={setMemberIds}
							label="Add channel members"
							placeholder="Add people"
							searchPlaceholder="Search name or email"
							emptyMessage="No one matches that search."
							disabled={create.isPending || contacts.isPending}
						/>
						<span className="text-xs text-app-text-muted">
							You join as the channel owner.
						</span>
					</div>

					<div className="flex justify-end gap-2">
						<Button variant="ghost" onPress={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button
							onPress={() => void submitCreate()}
							isDisabled={create.isPending}
						>
							{create.isPending && (
								<Loader2Icon aria-hidden className="animate-spin" />
							)}
							Create channel
						</Button>
					</div>
				</TabsContent>

				<TabsContent id="browse" className="flex flex-col gap-3 pt-2">
					<div className="relative">
						<SearchIcon
							aria-hidden
							className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-app-text-muted"
						/>
						<Input
							type="search"
							value={search}
							onChange={(event) => setSearch(event.target.value)}
							placeholder="Search public channels"
							aria-label="Search public channels"
							className="pl-7"
						/>
					</div>

					<div className="min-h-0 flex-1 overflow-y-auto border-y border-app-border">
						{browse.isPending ? (
							<p className="p-4 text-sm text-app-text-muted">
								Loading channels...
							</p>
						) : browse.isError ? (
							<p role="alert" className="p-4 text-sm text-danger">
								Could not load the channels.
							</p>
						) : browseRows.length === 0 ? (
							<p className="p-4 text-sm text-app-text-muted">
								{debounced.trim()
									? "No public channels match that search."
									: "There are no public channels yet. Create the first one."}
							</p>
						) : (
							<ul className="flex flex-col">
								{browseRows.map((channel) => (
									<li
										key={channel.id}
										className="flex items-center gap-3 border-b border-app-border px-2 py-2 last:border-b-0"
									>
										<span className="flex size-8 shrink-0 items-center justify-center border border-app-border text-app-text-muted">
											<HashIcon aria-hidden className="size-4" />
										</span>
										<span className="min-w-0 flex-1">
											<span className="block truncate text-sm font-medium text-app-text">
												{channel.title}
											</span>
											<span className="block truncate text-xs text-app-text-muted">
												{channel.description || "No topic yet"}
											</span>
											<span className="block text-[0.65rem] text-app-text-muted">
												{channel.memberCount}{" "}
												{channel.memberCount === 1 ? "member" : "members"}
											</span>
										</span>
										<Button
											size="sm"
											variant={channel.joined ? "outline" : "default"}
											onPress={() =>
												void joinChannel(channel.id, channel.joined)
											}
											isDisabled={join.isPending}
										>
											{channel.joined ? "Open" : "Join"}
										</Button>
									</li>
								))}
							</ul>
						)}

						{browse.hasNextPage && (
							<div className="flex justify-center p-2">
								<Button
									size="sm"
									variant="outline"
									onPress={() => void browse.fetchNextPage()}
									isDisabled={browse.isFetchingNextPage}
								>
									{browse.isFetchingNextPage ? "Loading..." : "Load more"}
								</Button>
							</div>
						)}
					</div>
				</TabsContent>
			</Tabs>
		</Dialog>
	);
}
