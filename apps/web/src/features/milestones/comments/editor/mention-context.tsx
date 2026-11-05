"use client";

/**
 * The context a mention node needs while it is being typed or read.
 *
 * Why context instead of props: a mention is rendered deep inside the Plate
 * node tree, several layers below the comment tab. Threading the organization
 * and project through every composer, item and static renderer would touch
 * every signature and still leave the input node with no way to search.
 *
 * Only the picker needs the values. The stored chip already carries the display
 * name and project slug, so rendering a stored mention works without this
 * context at all.
 *
 * Used by: mention-input.tsx and comment-editor.tsx.
 */

import { createContext, type ReactNode, useContext } from "react";

/** The organization and project a mention search is scoped to. */
export type MentionContextValue = {
	orgSlug: string;
	projectId: string;
};

const MentionContext = createContext<MentionContextValue | null>(null);

/** Provide the tenant and project to every mention input inside a comment. */
export function MentionProvider({
	value,
	children,
}: {
	value: MentionContextValue;
	children: ReactNode;
}) {
	return (
		<MentionContext.Provider value={value}>{children}</MentionContext.Provider>
	);
}

/** Read the mention context, or null when no provider is mounted. */
export function useMentionContext(): MentionContextValue | null {
	return useContext(MentionContext);
}
