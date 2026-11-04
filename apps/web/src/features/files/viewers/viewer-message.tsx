"use client";

/**
 * Loading and error states shared by the file viewers.
 *
 * Why shared: every viewer can be loading or can fail, and a consistent
 * message keeps the dialog from jumping between different layouts.
 *
 * Used by: features/files/viewers/*.
 */

import { cn } from "cn";
import type { ReactNode } from "react";

export function ViewerMessage({
	children,
	tone = "muted",
}: {
	children: ReactNode;
	tone?: "muted" | "error";
}) {
	return (
		<div
			role={tone === "error" ? "alert" : "status"}
			className={cn(
				"flex h-full min-h-40 items-center justify-center p-6 text-center text-sm",
				tone === "error" ? "text-danger" : "text-app-text-muted",
			)}
		>
			{children}
		</div>
	);
}
