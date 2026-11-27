"use client";

/**
 * The project Messages tab.
 *
 * Why this component owns the open call: the room does not exist until someone
 * opens the tab. The query is an idempotent open, and the resulting conversation
 * id feeds the shared conversation surface. Everything after that (timeline,
 * threads, search, composer, read cursor) is the messages feature.
 *
 * Used by: routes/_app/$orgSlug.projects.$projectSlug.messages.tsx.
 */

import { Button } from "@org/ui/components/button";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect } from "react";
import { authClient } from "#/features/auth/client";
import { ConversationView } from "#/features/messages/conversation-view";
import { useMessagesRealtime } from "#/features/messages/realtime";
import { useProjectDetailBySlug } from "#/features/projects/hooks";
import { projectConversationUnreadKey, useProjectConversation } from "./hooks";

export function ProjectMessagesPage({
	orgSlug,
	projectSlug,
	threadId,
}: {
	orgSlug: string;
	projectSlug: string;
	/** A root message id from a notification deep link. */
	threadId: string | null;
}) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const detail = useProjectDetailBySlug(orgSlug, projectSlug);
	const project = detail.data?.project ?? null;
	const conversation = useProjectConversation(orgSlug, project?.id ?? null);
	const conversationId = conversation.data?.conversation.id ?? null;
	const { data: session } = authClient.useSession();

	/*
	 * The messages page mounts this in its shell. The project tab has no shell
	 * of its own, so it mounts the same subscriber here and gets the same cache
	 * patching, typing relay and unread behaviour.
	 */
	useMessagesRealtime({
		orgSlug,
		viewerId: session?.user.id ?? "",
		activeConversationId: conversationId,
		activeThreadId: threadId,
	});

	/*
	 * Opening the room can be the first time it exists, so the tab dot query
	 * may still answer zero from before the open. Refresh it once the room id
	 * arrives, which also covers the case where joining changes the count.
	 */
	useEffect(() => {
		if (!project?.id || !conversationId) return;

		void queryClient.invalidateQueries({
			queryKey: projectConversationUnreadKey(orgSlug, project.id),
		});
	}, [conversationId, orgSlug, project?.id, queryClient]);

	const handleMissing = useCallback(() => {
		void navigate({
			to: "/$orgSlug/projects/$projectSlug",
			params: { orgSlug, projectSlug },
			replace: true,
		});
	}, [navigate, orgSlug, projectSlug]);

	const threadHref = useCallback(
		(rootId: string) =>
			`/${orgSlug}/projects/${projectSlug}/messages?thread=${encodeURIComponent(rootId)}`,
		[orgSlug, projectSlug],
	);

	if (detail.isPending || (project && conversation.isPending)) {
		return (
			<div className="flex h-full items-center justify-center p-6">
				<p className="text-sm text-app-text-muted">Opening messages...</p>
			</div>
		);
	}

	if (conversation.isError) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-3 p-6">
				<p role="alert" className="text-sm text-danger">
					{conversation.error instanceof Error
						? conversation.error.message
						: "Could not open the project messages."}
				</p>
				<Button
					variant="outline"
					size="sm"
					onPress={() => void conversation.refetch()}
				>
					<RefreshCwIcon aria-hidden />
					Try again
				</Button>
			</div>
		);
	}

	if (!conversationId) return null;

	return (
		<ConversationView
			orgSlug={orgSlug}
			conversationId={conversationId}
			projectName={project?.name}
			threadHref={threadHref}
			initialThreadId={threadId}
			onMissing={handleMissing}
		/>
	);
}
