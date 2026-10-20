/**
 * Sign-in methods section.
 *
 * Shows every authentication method linked to the account and lets the user
 * connect or disconnect Google and GitHub. Disconnect is disabled when it is
 * the last method, and Better Auth independently refuses to unlink the only
 * account, so the guarantee holds on both sides.
 *
 * Used by: src/routes/_app/account.tsx.
 */

import { Button } from "@org/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@org/ui/components/card";
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@org/ui/components/dialog";
import { Separator } from "@org/ui/components/separator";
import { Skeleton } from "@org/ui/components/skeleton";
import { GithubLight as GithubIcon } from "@org/ui/components/ui/svgs/githubLight";
import { Google } from "@org/ui/components/ui/svgs/google";
import { type ComponentType, useState } from "react";

import {
	type LinkedAccount,
	type SocialProvider,
	useLinkAccount,
	useLinkedAccounts,
	useUnlinkAccount,
} from "./hooks";

const PROVIDERS: Array<{
	id: SocialProvider;
	label: string;
	Icon: ComponentType<{ className?: string }>;
}> = [
	{ id: "google", label: "Google", Icon: Google },
	{ id: "github", label: "GitHub", Icon: GithubIcon },
];

function providerLabel(providerId: string): string {
	if (providerId === "credential") return "email and password";

	return (
		PROVIDERS.find((provider) => provider.id === providerId)?.label ??
		providerId
	);
}

export function SignInMethodsCard({ hasPassword }: { hasPassword: boolean }) {
	const accountsQuery = useLinkedAccounts();
	const linkAccount = useLinkAccount();
	const unlinkAccount = useUnlinkAccount();
	const [pendingUnlink, setPendingUnlink] = useState<LinkedAccount | null>(
		null,
	);

	const accounts = accountsQuery.data;
	const credentialAccount = accounts?.find(
		(account) => account.providerId === "credential",
	);
	const canDisconnect = (accounts?.length ?? 0) > 1;
	const actionError = linkAccount.error ?? unlinkAccount.error;

	async function handleLink(provider: SocialProvider) {
		try {
			await linkAccount.mutateAsync(provider);
		} catch {
			// The mutation error is rendered below.
		}
	}

	async function handleUnlink() {
		if (!pendingUnlink) return;

		try {
			await unlinkAccount.mutateAsync(pendingUnlink.id);
			setPendingUnlink(null);
			await accountsQuery.refetch();
		} catch {
			// The mutation error is rendered below.
		}
	}

	function closeDialog() {
		setPendingUnlink(null);
		unlinkAccount.reset();
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Sign-in methods</CardTitle>
				<CardDescription>
					Connect the accounts you use to sign in. You always need at least one.
				</CardDescription>
			</CardHeader>

			<CardContent className="flex flex-col gap-4">
				{accountsQuery.isPending && (
					<div className="flex flex-col gap-3">
						<Skeleton className="h-10 w-full" />
						<Skeleton className="h-10 w-full" />
					</div>
				)}

				{accountsQuery.isError && (
					<p role="alert" className="text-sm text-danger">
						{accountsQuery.error instanceof Error
							? accountsQuery.error.message
							: "Could not load your sign-in methods."}
					</p>
				)}

				{accounts && (
					<div className="flex flex-col gap-4">
						{PROVIDERS.map(({ id, label, Icon }) => {
							const account = accounts.find((item) => item.providerId === id);
							const isLinking =
								linkAccount.isPending && linkAccount.variables === id;

							return (
								<div key={id} className="flex flex-col gap-3">
									<div className="flex flex-wrap items-center justify-between gap-3">
										<div className="flex items-center gap-3">
											<Icon className="size-5" />
											<div>
												<p className="text-sm font-medium text-app-text">
													{label}
												</p>
												<p className="text-xs text-app-text-muted">
													{account ? "Connected" : "Not connected"}
												</p>
											</div>
										</div>

										{account ? (
											<Button
												variant="outline"
												size="sm"
												isDisabled={!canDisconnect}
												onPress={() => {
													unlinkAccount.reset();
													setPendingUnlink(account);
												}}
											>
												Disconnect
											</Button>
										) : (
											<Button
												variant="outline"
												size="sm"
												loading={isLinking}
												onPress={() => handleLink(id)}
											>
												Connect
											</Button>
										)}
									</div>
									<Separator />
								</div>
							);
						})}

						{hasPassword && credentialAccount && (
							<div className="flex flex-wrap items-center justify-between gap-3">
								<div>
									<p className="text-sm font-medium text-app-text">
										Email and password
									</p>
									<p className="text-xs text-app-text-muted">Connected</p>
								</div>
								<Button
									variant="outline"
									size="sm"
									isDisabled={!canDisconnect}
									onPress={() => {
										unlinkAccount.reset();
										setPendingUnlink(credentialAccount);
									}}
								>
									Disconnect
								</Button>
							</div>
						)}
					</div>
				)}

				{!canDisconnect && accounts && accounts.length > 0 && (
					<p className="text-xs text-app-text-muted">
						Connect another method before disconnecting your only one.
					</p>
				)}

				{actionError && (
					<p role="alert" className="text-sm text-danger">
						{actionError instanceof Error
							? actionError.message
							: "Could not update your sign-in methods."}
					</p>
				)}
			</CardContent>

			<Dialog
				isOpen={pendingUnlink !== null}
				onOpenChange={(open) => {
					if (!open) closeDialog();
				}}
			>
				<DialogHeader>
					<DialogTitle>Disconnect sign-in method</DialogTitle>
				</DialogHeader>
				<DialogDescription>
					You will no longer be able to sign in with{" "}
					{pendingUnlink
						? providerLabel(pendingUnlink.providerId)
						: "this provider"}
					. Your other sign-in methods stay active.
				</DialogDescription>
				<DialogFooter>
					<Button variant="outline" onPress={closeDialog}>
						Cancel
					</Button>
					<Button
						variant="destructive"
						loading={unlinkAccount.isPending}
						onPress={handleUnlink}
					>
						Disconnect
					</Button>
				</DialogFooter>
			</Dialog>
		</Card>
	);
}
