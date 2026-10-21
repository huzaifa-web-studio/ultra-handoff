import { Button } from "@org/ui/components/button";
import { LogOutIcon } from "lucide-react";

import { DeleteAccountDialog } from "#/features/account/delete-account-dialog";

/**
 * Header for the public landing / no-organization page.
 *
 * Why one component: the page has two visual states (signed-out and
 * signed-in-without-organization) that share the same brand placement and
 * layout. Branching the right-hand cluster here keeps `index.tsx` free of
 * duplicated header markup.
 *
 * Used by: src/routes/index.tsx.
 */
type Session = {
	user?: { email?: string } | null;
	session?: { activeOrganizationId?: string | null } | null;
} | null;

export function HomeHeader({
	session,
	needsOrg,
	onSignOut,
	onOpenSignIn,
	onOpenSignUp,
}: {
	session: Session;
	needsOrg: boolean;
	onSignOut: () => void | Promise<void>;
	onOpenSignIn: () => void;
	onOpenSignUp: () => void;
}) {
	return (
		<header className="flex items-center justify-between border-b border-app-border px-6 py-4">
			<span className="font-display text-lg font-bold text-app-text">
				Ultra Handoff
			</span>
			<div className="flex items-center gap-2">
				{needsOrg ? (
					<>
						<Button
							variant="outline"
							size="sm"
							onPress={onSignOut}
							aria-label="Sign out"
						>
							<LogOutIcon />
							<span className="hidden sm:inline">Sign out</span>
						</Button>
						<DeleteAccountDialog />
					</>
				) : session?.user ? (
					<Button variant="outline" onPress={onSignOut}>
						Sign out
					</Button>
				) : (
					<>
						<Button variant="outline" onPress={onOpenSignIn}>
							Sign in
						</Button>
						<Button onPress={onOpenSignUp}>Sign up</Button>
					</>
				)}
			</div>
		</header>
	);
}
