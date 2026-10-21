import { Button } from "@org/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@org/ui/components/card";
import { GithubLight as GithubIcon } from "@org/ui/components/ui/svgs/githubLight";
import { Google } from "@org/ui/components/ui/svgs/google";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
	ArrowRightIcon,
	CalendarClockIcon,
	CheckIcon,
	LogInIcon,
	LogOutIcon,
	MailIcon,
	RefreshCwIcon,
	XIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { RoleChip } from "#/components/role-chip";
import { authClient } from "#/features/auth/client";
import { openSignIn } from "#/features/auth/store";
import { broadcastAuth } from "#/features/auth/sync";
import { useSwitchOrganization } from "#/features/organization/switch";
import { openSwitchBlockedDialog } from "#/features/organization/switch-blocked-store";
import { getSwitchBlock } from "#/features/organization/switch-guard";
import { useCooldown } from "#/hooks/use-cooldown";
import { formatRelativeTime } from "#/lib/date";
import { useInvitationMagicLink, useInvitationPreview } from "./hooks";

/**
 * Invitation acceptance card.
 *
 * Why a state machine instead of one button: the visitor may be signed out,
 * signed in as the wrong person, unverified, or arriving from a magic link.
 * Each state has a different next action, and the server tells us which state
 * applies through `preview.viewer`, so the card never has to guess or expose the
 * invited address.
 *
 * Used by: routes/invite.$invitationId.tsx.
 */

type InviteAcceptCardProps = {
	invitationId: string;
	/** True when the page returned from a magic link and should auto accept. */
	verify: boolean;
};

export function InviteAcceptCard({
	invitationId,
	verify,
}: InviteAcceptCardProps) {
	const navigate = useNavigate();
	const switchOrganization = useSwitchOrganization();
	const { data: session, isPending: sessionPending } = authClient.useSession();
	const { data: activeOrganization } = authClient.useActiveOrganization();

	const viewerKey = session?.user?.id ?? "anonymous";
	const previewQuery = useInvitationPreview(invitationId, viewerKey);
	const magicLink = useInvitationMagicLink(invitationId);

	const magicCooldown = useCooldown();
	const verifyCooldown = useCooldown();

	const [magicSent, setMagicSent] = useState(false);
	const [declined, setDeclined] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);
	const autoAccepted = useRef(false);

	const preview = previewQuery.data;

	const canAccept =
		preview?.status === "pending" &&
		preview.viewer.emailMatches === true &&
		preview.viewer.emailVerified;

	/**
	 * Open the workspace after acceptance.
	 *
	 * Resolves the slug again instead of trusting the preview: an owner may have
	 * renamed the workspace between the invite and the click.
	 */
	async function openWorkspace() {
		const { data: organizations } = await authClient.organization.list();
		const organization = organizations?.find(
			(item) => item.id === preview?.organizationId,
		);

		if (!organization) {
			navigate({ to: "/" });
			return;
		}

		await switchOrganization({
			organizationId: organization.id,
			organizationSlug: organization.slug,
			organizationName: organization.name,
			force: true,
			previousOrganizationSlug: activeOrganization?.slug,
		});
	}

	const acceptMutation = useMutation({
		mutationFn: async () => {
			if (!preview) throw new Error("This invitation is not available.");

			// The switch guard is checked before acceptance because Better Auth
			// changes the active organization server side. A long running
			// operation in the current workspace must block that switch first.
			const block = getSwitchBlock(
				activeOrganization?.id,
				preview.organizationId,
			);

			if (block) {
				openSwitchBlockedDialog({
					reason: block.reason,
					targetName: preview.organizationName,
				});
				throw new Error("blocked");
			}

			const { error } = await authClient.organization.acceptInvitation({
				invitationId,
			});

			if (error) {
				const code = (error as { code?: string }).code;

				if (code === "USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION") {
					await openWorkspace();
					return;
				}

				throw new Error(error.message ?? "Could not accept this invitation.");
			}

			toast.success(`Welcome to ${preview.organizationName}.`);

			// The accept call already set the active organization. The helper
			// syncs the session, the cross tab broadcast and the URL.
			await openWorkspace();
		},
		// A failed accept often means the invitation changed while the page was
		// open (expired, canceled, already used). Refresh so the card explains
		// the real state instead of leaving a stale button.
		onError: async () => {
			await previewQuery.refetch();
		},
	});

	// Arriving from the magic link: accept once the session is ready. The ref
	// stops a failed attempt from retrying on every render.
	useEffect(() => {
		if (!verify || !canAccept || sessionPending || autoAccepted.current) {
			return;
		}

		autoAccepted.current = true;
		acceptMutation.mutate();
	}, [verify, canAccept, sessionPending, acceptMutation]);

	const rejectMutation = useMutation({
		mutationFn: async () => {
			const { error } = await authClient.organization.rejectInvitation({
				invitationId,
			});

			if (error) {
				throw new Error(error.message ?? "Could not decline this invitation.");
			}
		},
		onSuccess: async () => {
			setDeclined(true);
			await previewQuery.refetch();
		},
	});

	/**
	 * Sign in with a social provider and come back to this invitation.
	 *
	 * Why the callback is the current URL: the default redirect goes home, so
	 * the invitee would land on the dashboard with the invitation still
	 * pending. Returning here lets the same session match the invited email
	 * and accept in one step.
	 */
	async function handleSocial(provider: "github" | "google") {
		setActionError(null);

		const { error } = await authClient.signIn.social({
			provider,
			callbackURL: window.location.href,
		});

		if (error) {
			setActionError(
				error.message ??
					`Could not continue with ${provider === "github" ? "GitHub" : "Google"}.`,
			);
		}
	}

	async function handleMagicLink() {
		setActionError(null);

		try {
			await magicLink.mutateAsync();
			setMagicSent(true);
			magicCooldown.start();
		} catch (error) {
			setActionError(
				error instanceof Error
					? error.message
					: "Could not send a sign-in link.",
			);
			// The invitation may have expired or been canceled while open.
			await previewQuery.refetch();
		}
	}

	/** Button wrapper, so a failed switch is reported rather than unhandled. */
	function handleOpenWorkspace() {
		void openWorkspace().catch((error: unknown) => {
			toast.error(
				error instanceof Error
					? error.message
					: "Could not open the workspace.",
			);
		});
	}

	async function handleSignOut() {
		await authClient.signOut();
		broadcastAuth("auth:signed-out");
		setMagicSent(false);
		setActionError(null);
	}

	async function handleResendVerification() {
		if (!session?.user.email) return;

		setActionError(null);

		try {
			const { error } = await authClient.sendVerificationEmail({
				email: session.user.email,
			});

			if (error) {
				throw new Error(
					error.message ?? "Could not send the verification email.",
				);
			}

			toast.success("Verification email sent.");
			verifyCooldown.start();
		} catch (error) {
			setActionError(
				error instanceof Error
					? error.message
					: "Could not send the verification email.",
			);
		}
	}

	if (previewQuery.isPending) {
		return <StateCard title="Loading invitation">One moment.</StateCard>;
	}

	if (previewQuery.isError || !preview) {
		return (
			<StateCard
				title="Invitation unavailable"
				description={
					previewQuery.error instanceof Error
						? previewQuery.error.message
						: "This invitation link is not valid."
				}
			>
				<Button onPress={() => navigate({ to: "/" })}>
					<ArrowRightIcon aria-hidden />
					Go to Handoff
				</Button>
			</StateCard>
		);
	}

	if (preview.status === "accepted") {
		return (
			<StateCard
				title="Invitation already used"
				description={`This invitation to ${preview.organizationName} has already been accepted.`}
			>
				{preview.viewer.emailMatches === true ? (
					<Button onPress={handleOpenWorkspace}>
						<ArrowRightIcon aria-hidden />
						Open workspace
					</Button>
				) : (
					<Button onPress={() => navigate({ to: "/" })}>
						<ArrowRightIcon aria-hidden />
						Go to Handoff
					</Button>
				)}
			</StateCard>
		);
	}

	if (preview.status === "rejected") {
		return (
			<StateCard
				title="Invitation declined"
				description={`This invitation to ${preview.organizationName} was declined. Ask ${preview.inviterName} if you changed your mind.`}
			>
				<Button variant="outline" onPress={() => navigate({ to: "/" })}>
					<ArrowRightIcon aria-hidden />
					Go to Handoff
				</Button>
			</StateCard>
		);
	}

	if (preview.status === "canceled") {
		return (
			<StateCard
				title="Invitation canceled"
				description={`This invitation to ${preview.organizationName} was canceled. Ask ${preview.inviterName} to invite you again.`}
			>
				<Button variant="outline" onPress={() => navigate({ to: "/" })}>
					<ArrowRightIcon aria-hidden />
					Go to Handoff
				</Button>
			</StateCard>
		);
	}

	if (preview.status === "expired") {
		return (
			<StateCard
				title="Invitation expired"
				description={`This invitation to ${preview.organizationName} expired ${formatRelativeTime(preview.expiresAt)}. Ask ${preview.inviterName} to send a new one.`}
			>
				<Button variant="outline" onPress={() => navigate({ to: "/" })}>
					<ArrowRightIcon aria-hidden />
					Go to Handoff
				</Button>
			</StateCard>
		);
	}

	if (declined) {
		return (
			<StateCard
				title="Invitation declined"
				description={`You declined the invitation to ${preview.organizationName}. Nothing was changed.`}
			>
				<Button variant="outline" onPress={() => navigate({ to: "/" })}>
					<ArrowRightIcon aria-hidden />
					Go to Handoff
				</Button>
			</StateCard>
		);
	}

	const invitationDetails = (
		<div className="flex flex-col gap-3 border border-app-border bg-app-panel-subtle p-3">
			<div className="flex flex-wrap items-center gap-2">
				<span className="text-xs font-semibold tracking-widest text-app-text-muted uppercase">
					Role
				</span>
				<RoleChip role={preview.role} />
			</div>
			<div className="flex items-start gap-2 text-sm text-app-text-muted">
				<MailIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
				<span>
					Sent to <span className="text-app-text">{preview.maskedEmail}</span>
				</span>
			</div>
			<div className="flex items-start gap-2 text-sm text-app-text-muted">
				<CalendarClockIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
				<span>Expires {formatRelativeTime(preview.expiresAt)}</span>
			</div>
		</div>
	);

	// Signed out: offer the passwordless path first, password sign in second.
	if (!preview.viewer.signedIn) {
		return (
			<StateCard
				title={`You are invited to ${preview.organizationName}`}
				description={`${preview.inviterName} invited you to join as ${roleLabel(preview.role)}.`}
			>
				{invitationDetails}

				{/*
				 * Social sign-in is a first class option, not a detour through
				 * the dialog. The provider email must match the invited address,
				 * which the server checks before the accept state appears.
				 */}
				<div className="flex flex-col gap-2">
					<Button variant="outline" onPress={() => handleSocial("github")}>
						<GithubIcon className="h-4 w-4" /> Continue with GitHub
					</Button>
					<Button variant="outline" onPress={() => handleSocial("google")}>
						<Google className="h-4 w-4" /> Continue with Google
					</Button>
				</div>

				<div className="flex items-center gap-3">
					<span className="h-px flex-1 bg-app-border" />
					<span className="text-xs font-semibold tracking-widest text-app-text-muted uppercase">
						or
					</span>
					<span className="h-px flex-1 bg-app-border" />
				</div>

				{magicSent ? (
					<div
						aria-live="polite"
						className="flex flex-col gap-3 border border-success bg-success-bg p-3"
					>
						<p className="text-sm text-success">
							Check your inbox. We sent a sign-in link to {preview.maskedEmail}.
							It expires in ten minutes.
						</p>
						<Button
							variant="outline"
							size="sm"
							onPress={handleMagicLink}
							isDisabled={magicCooldown.isActive || magicLink.isPending}
							loading={magicLink.isPending}
						>
							<RefreshCwIcon aria-hidden />
							{magicCooldown.isActive
								? `Resend in ${magicCooldown.remaining}s`
								: "Resend link"}
						</Button>
					</div>
				) : (
					<Button loading={magicLink.isPending} onPress={handleMagicLink}>
						<MailIcon aria-hidden />
						Email me a sign-in link
					</Button>
				)}

				<Button
					variant="outline"
					onPress={() => {
						// The route mounts AuthDialog. Signing in refreshes the
						// session, which refetches the preview and moves this card
						// to the accept state.
						openSignIn();
					}}
				>
					<LogInIcon aria-hidden />
					Sign in with email and password
				</Button>

				{actionError && (
					<p role="alert" className="text-sm text-danger">
						{actionError}
					</p>
				)}
			</StateCard>
		);
	}

	// Signed in as someone else.
	if (preview.viewer.emailMatches === false) {
		return (
			<StateCard
				title="This invitation belongs to another address"
				description={`You are signed in as ${session?.user.email}. This invitation was sent to ${preview.maskedEmail}.`}
			>
				{invitationDetails}
				<Button onPress={handleSignOut}>
					<LogOutIcon aria-hidden />
					Sign out and use the invited address
				</Button>
				<Button variant="outline" onPress={() => navigate({ to: "/" })}>
					<ArrowRightIcon aria-hidden />
					Back to Handoff
				</Button>
			</StateCard>
		);
	}

	// Right address, not verified yet. Only password accounts reach this.
	if (!preview.viewer.emailVerified) {
		return (
			<StateCard
				title="Verify your email to accept"
				description={`Confirm ${session?.user.email} before joining ${preview.organizationName}.`}
			>
				{invitationDetails}
				<Button
					loading={verifyCooldown.isActive}
					onPress={handleResendVerification}
					isDisabled={verifyCooldown.isActive}
				>
					<MailIcon aria-hidden />
					{verifyCooldown.isActive
						? `Resend in ${verifyCooldown.remaining}s`
						: "Resend verification email"}
				</Button>
				<p className="text-xs text-app-text-muted">
					Open the link in the verification email, then come back to this page.
				</p>
				<Button
					variant="outline"
					onPress={() => {
						void (async () => {
							await authClient.getSession();
							await previewQuery.refetch();
						})();
					}}
				>
					<RefreshCwIcon aria-hidden />I verified my email
				</Button>
				<Button variant="ghost" onPress={handleSignOut}>
					<LogOutIcon aria-hidden />
					Use a different account
				</Button>
				{actionError && (
					<p role="alert" className="text-sm text-danger">
						{actionError}
					</p>
				)}
			</StateCard>
		);
	}

	// Ready to accept.
	return (
		<StateCard
			title={`Join ${preview.organizationName}`}
			description={`${preview.inviterName} invited you to join as ${roleLabel(preview.role)}.`}
		>
			{invitationDetails}

			<div className="flex flex-col gap-2">
				<Button
					loading={acceptMutation.isPending}
					onPress={() => acceptMutation.mutate()}
				>
					<CheckIcon aria-hidden />
					{acceptMutation.isPending ? "Accepting..." : "Accept invitation"}
				</Button>
				<Button
					variant="ghost"
					onPress={() => rejectMutation.mutate()}
					isDisabled={rejectMutation.isPending || acceptMutation.isPending}
					loading={rejectMutation.isPending}
				>
					<XIcon aria-hidden />
					Decline invitation
				</Button>
			</div>

			{acceptMutation.isError && acceptMutation.error.message !== "blocked" && (
				<p role="alert" className="text-sm text-danger">
					{acceptMutation.error.message}
				</p>
			)}

			{actionError && (
				<p role="alert" className="text-sm text-danger">
					{actionError}
				</p>
			)}
		</StateCard>
	);
}

/** Shared card shell so every state looks like the same page. */
function StateCard({
	title,
	description,
	children,
}: {
	title: string;
	description?: string;
	children?: React.ReactNode;
}) {
	return (
		<Card className="w-full max-w-md">
			<CardHeader>
				<CardTitle>{title}</CardTitle>
				{description && <CardDescription>{description}</CardDescription>}
			</CardHeader>
			<CardContent className="flex flex-col gap-4">{children}</CardContent>
		</Card>
	);
}

/** Readable role label for the invitation copy. */
function roleLabel(role: string): string {
	switch (role) {
		case "owner":
			return "an owner";
		case "admin":
			return "an admin";
		default:
			return "a member";
	}
}
