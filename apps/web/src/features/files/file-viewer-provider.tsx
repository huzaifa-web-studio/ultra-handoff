"use client";

/**
 * One file viewer for the whole app.
 *
 * Why a provider instead of a dialog per chip: attachment chips live inside a
 * Plate editable and inside the static renderer. Mounting a modal there fights
 * the editor for focus and re-mounts it whenever the editor updates, which is a
 * reliable way to produce a flicker. A single dialog at the root is mounted
 * once, outside every editable, and any chip opens it through context.
 *
 * Used by: routes/__root.tsx.
 */

import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import { FileViewerDialog, type ViewerFile } from "./file-viewer-dialog";

type FileViewerContextValue = {
	/** Open the viewer for a file. */
	open: (file: ViewerFile) => void;
};

const FileViewerContext = createContext<FileViewerContextValue | null>(null);

export function FileViewerProvider({ children }: { children: ReactNode }) {
	const [file, setFile] = useState<ViewerFile | null>(null);
	const [isOpen, setIsOpen] = useState(false);

	const open = useCallback((next: ViewerFile) => {
		setFile(next);
		setIsOpen(true);
	}, []);

	// Keep the last file while the dialog closes so the exit state has content
	// to render. The next open replaces it.
	const handleOpenChange = useCallback((next: boolean) => {
		setIsOpen(next);
	}, []);

	const value = useMemo(() => ({ open }), [open]);

	return (
		<FileViewerContext.Provider value={value}>
			{children}

			{file && (
				<FileViewerDialog
					file={file}
					isOpen={isOpen}
					onOpenChange={handleOpenChange}
				/>
			)}
		</FileViewerContext.Provider>
	);
}

/** Open the shared file viewer. Throws when the provider is missing. */
export function useFileViewer(): FileViewerContextValue {
	const context = useContext(FileViewerContext);

	if (!context) {
		throw new Error("FileViewerProvider is missing");
	}

	return context;
}
