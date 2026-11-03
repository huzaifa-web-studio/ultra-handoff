"use client";

/**
 * Tells editor node components whether they are inside the static viewer.
 *
 * Why this exists: `PlateStatic` does not mount the editable surface, so
 * slate-react's own read-only context still reports false. A checklist item
 * needs to know the difference, otherwise its checkbox would look and behave
 * as an interactive control in a client's read-only view.
 *
 * Used by: editor-elements.tsx and milestone-editor.tsx.
 */

import { createContext, type ReactNode, useContext } from "react";

/** False while editing, true inside the static render. */
const EditorStaticContext = createContext(false);

export function EditorStaticProvider({ children }: { children: ReactNode }) {
	return (
		<EditorStaticContext.Provider value>
			{children}
		</EditorStaticContext.Provider>
	);
}

/** True when the current node is rendered by PlateStatic. */
export function useEditorStatic(): boolean {
	return useContext(EditorStaticContext);
}
