"use client";

/**
 * The milestone tab strip.
 *
 * Why this file: the fixed sections and the reader opened tabs share one
 * horizontally scrolling strip, and the badge counts come from two different
 * queries. Keeping the strip together means the section order and the divider
 * rule cannot drift.
 *
 * Used by: `milestone-detail-panel.tsx`.
 */

import { TabsList, TabsTrigger } from "@org/ui/components/tabs";
import type { OpenCommentTab } from "../comments/tabs-storage";
import type { OpenScopeTab } from "../scope/tabs-storage";
import { commentTabKey, scopeTabKey } from "../tabs";
import { ReaderTabTrigger } from "./atoms";

/** A mutable ref, kept structural so the component does not import React types. */
type Mutable<T> = { current: T };

export function MilestoneTabStrip({
	openChangeRequestCount,
	unreadComments,
	scopeTabs,
	commentTabs,
	closeScopeTab,
	closeCommentTab,
	tabRefs,
}: {
	openChangeRequestCount: number;
	unreadComments: number;
	scopeTabs: OpenScopeTab[];
	commentTabs: OpenCommentTab[];
	closeScopeTab: (id: string) => void;
	closeCommentTab: (id: string) => void;
	tabRefs: Mutable<Map<string, HTMLDivElement>>;
}) {
	return (
		<TabsList
			variant="line"
			aria-label="Milestone sections"
			className="w-full justify-start overflow-x-auto overflow-y-hidden border-b border-app-border px-2"
		>
			<TabsTrigger id="overview" className="flex-none cursor-pointer">
				Overview
			</TabsTrigger>
			<TabsTrigger id="scope" className="flex-none cursor-pointer">
				Scope
			</TabsTrigger>
			<TabsTrigger id="changes" className="flex-none cursor-pointer gap-1.5">
				Changes
				{openChangeRequestCount > 0 && (
					<span className="bg-app-selected px-1.5 py-0.5 text-[0.6rem] font-semibold tabular-nums text-app-text">
						{openChangeRequestCount}
					</span>
				)}
			</TabsTrigger>
			<TabsTrigger id="comments" className="flex-none cursor-pointer gap-1.5">
				Comments
				{unreadComments > 0 ? (
					<span className="bg-app-attention px-1.5 py-0.5 text-[0.6rem] font-semibold text-app-attention-text tabular-nums">
						{unreadComments}
					</span>
				) : null}
			</TabsTrigger>

			{/*
			 * Reader opened tabs. Scope tabs come first, then focused
			 * discussions, so the strip groups by what the tab shows. The
			 * first one carries the vertical rule that separates the fixed
			 * sections from the reader's own tabs. The list scrolls
			 * horizontally, so opening many stays usable.
			 */}
			{scopeTabs.map((tab, index) => {
				const key = scopeTabKey(tab.id);

				return (
					<ReaderTabTrigger
						key={key}
						tabKey={key}
						label={tab.label}
						ariaLabel={tab.label}
						first={index === 0}
						onClose={() => closeScopeTab(tab.id)}
						registerRef={(element) => {
							if (element) {
								tabRefs.current.set(key, element);
							} else {
								tabRefs.current.delete(key);
							}
						}}
					/>
				);
			})}

			{commentTabs.map((tab, index) => {
				const key = commentTabKey(tab.id);

				return (
					<ReaderTabTrigger
						key={key}
						tabKey={key}
						label={tab.label}
						ariaLabel={tab.title}
						first={scopeTabs.length === 0 && index === 0}
						onClose={() => closeCommentTab(tab.id)}
						registerRef={(element) => {
							if (element) {
								tabRefs.current.set(key, element);
							} else {
								tabRefs.current.delete(key);
							}
						}}
					/>
				);
			})}
		</TabsList>
	);
}
