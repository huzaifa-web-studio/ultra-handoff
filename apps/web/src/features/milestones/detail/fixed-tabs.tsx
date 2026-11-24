"use client";

/**
 * The fixed milestone tab panes.
 *
 * Why this file: Scope, Changes and Comments are always present, unlike the
 * reader opened tabs. Keeping them together means the content component owns
 * state and drafts while these three panes stay a readable, fixed layout.
 *
 * Used by: `milestone-detail-panel.tsx`.
 */

import { TabsContent } from "@org/ui/components/tabs";
import type {
	MilestoneDetail,
	MilestoneScopeEntrySummary,
	MilestoneViewer,
} from "../api";
import { ChangesTab } from "../changes/changes-tab";
import type { Comment } from "../comments/api";
import { CommentTab } from "../comments/comment-tab";
import type { AssignableMember } from "../milestone-assignee-field";
import { ScopeTab } from "../scope/scope-tab";
import type { MilestoneTabKey } from "../tabs";

export function MilestoneFixedTabs({
	orgSlug,
	organizationId,
	projectSlug,
	projectId,
	milestone,
	viewer,
	members,
	locked,
	canEditFields,
	scopeEntries,
	effectiveSelectedTab,
	commentsOpened,
	openBaselineScopeTab,
	openEntryScopeTab,
	openCommentTab,
	onTabChange,
}: {
	orgSlug: string;
	organizationId: string;
	projectSlug: string;
	projectId: string;
	milestone: MilestoneDetail;
	viewer: MilestoneViewer;
	members: AssignableMember[];
	locked: boolean;
	canEditFields: boolean;
	scopeEntries: MilestoneScopeEntrySummary[];
	effectiveSelectedTab: MilestoneTabKey;
	commentsOpened: boolean;
	openBaselineScopeTab: () => void;
	openEntryScopeTab: (entry: MilestoneScopeEntrySummary) => void;
	openCommentTab: (comment: Comment) => void;
	onTabChange: (tab: MilestoneTabKey) => void;
}) {
	return (
		<>
			<TabsContent
				id="scope"
				shouldForceMount
				className="flex min-h-0 flex-1 flex-col data-[inert]:hidden"
			>
				{effectiveSelectedTab === "scope" && (
					<ScopeTab
						milestone={milestone}
						phase={milestone.phase}
						viewer={viewer}
						locked={locked}
						canEditFields={canEditFields}
						onOpenBaseline={openBaselineScopeTab}
						onOpenEntry={openEntryScopeTab}
					/>
				)}
			</TabsContent>

			<TabsContent
				id="changes"
				shouldForceMount
				className="flex min-h-0 flex-1 flex-col data-[inert]:hidden"
			>
				<ChangesTab
					orgSlug={orgSlug}
					organizationId={organizationId}
					projectSlug={projectSlug}
					projectId={projectId}
					milestoneId={milestone.id}
					archived={viewer.archived}
					canCreate={viewer.canComment}
					canDecide={viewer.canWrite}
					members={members}
					active={effectiveSelectedTab === "changes"}
					onOpenScope={(scopeEntryId) => {
						if (!scopeEntryId) {
							onTabChange("scope");
							return;
						}

						const entry = scopeEntries.find((item) => item.id === scopeEntryId);

						if (entry) openEntryScopeTab(entry);
						else onTabChange("scope");
					}}
				/>
			</TabsContent>

			<TabsContent
				id="comments"
				shouldForceMount
				className="flex min-h-0 flex-1 flex-col data-[inert]:hidden"
			>
				{commentsOpened && (
					<CommentTab
						orgSlug={orgSlug}
						organizationId={organizationId}
						projectId={projectId}
						milestoneId={milestone.id}
						viewerId={viewer.userId}
						canComment={viewer.canComment}
						archived={viewer.archived}
						active={effectiveSelectedTab === "comments"}
						onOpenCommentTab={openCommentTab}
					/>
				)}
			</TabsContent>
		</>
	);
}
