import { Button } from "@org/ui/components/button";
import { SidebarTrigger } from "@org/ui/components/sidebar";

interface AppHeaderProps {
	title: string;
	userEmail: string;
	onSignOut: () => void | Promise<void>;
}

export function AppHeader({ title, userEmail, onSignOut }: AppHeaderProps) {
	return (
		<header className="flex h-14 items-center justify-between border-b border-app-border px-4">
			<div className="flex items-center gap-2">
				<SidebarTrigger />
				<span className="text-sm font-semibold text-app-text">{title}</span>
			</div>
			<div className="flex items-center gap-3">
				<span className="text-sm text-app-text-muted">{userEmail}</span>
				<Button variant="outline" onPress={onSignOut}>
					Sign out
				</Button>
			</div>
		</header>
	);
}
