import { Button } from "@org/ui/components/button";
import { LogOutIcon, Trash2Icon } from "lucide-react";

/**
 * Header for the no-organization landing page.
 *
 * Why a separate component: this page is the only place where sign-out and
 * delete-account live in the header instead of the sidebar, so the markup is
 * kept here rather than leaking into the route file.
 *
 * Used by: src/routes/index.tsx (needsOrg branch).
 */
export function NoOrgHeader({
	onSignOut,
	onDeleteAccount,
}: {
	onSignOut: () => void | Promise<void>;
	onDeleteAccount: () => void;
}) {
	return (
		<header className="flex items-center justify-between  border-b border-app-border px-6 py-4">
			<span className="font-display text-lg font-bold text-app-text">
				Ultra Handoff
			</span>
			<div className="flex items-center gap-2">
				<Button
					variant="outline"
					size="sm"
					onPress={onSignOut}
					aria-label="Sign out"
				>
					<LogOutIcon />
					<span className="hidden sm:inline">Sign out</span>
				</Button>
				<Button
					variant="outline"
					size="sm"
					className="text-danger"
					onPress={onDeleteAccount}
					aria-label="Delete account"
				>
					<Trash2Icon />
					<span className="hidden sm:inline">Delete account</span>
				</Button>
			</div>
		</header>
	);
}
