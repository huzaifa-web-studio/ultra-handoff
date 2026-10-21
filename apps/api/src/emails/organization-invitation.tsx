import {
	Body,
	Container,
	Head,
	Heading,
	Html,
	Link,
	Preview,
	Section,
	Text,
} from "@react-email/components";

/**
 * Organization invitation email.
 *
 * Why a dedicated template: an invitation is the first thing a future client
 * or teammate sees from Handoff, so it states who invited them, to which
 * workspace, in what role, and how long the link lasts. The link is single use
 * and points at the web accept page, which explains expired or canceled
 * invitations instead of dropping the user on a raw API error.
 *
 * Used by: src/lib/mailer.tsx when the organization plugin sends an invite.
 */

interface OrganizationInvitationEmailProps {
	url: string;
	organizationName: string;
	inviterName: string;
	role: string;
	expiresAt: string | Date;
}

/** Human readable role label, matching the web app's copy. */
function roleLabel(role: string): string {
	switch (role) {
		case "owner":
			return "Owner";
		case "admin":
			return "Admin";
		default:
			return "Member";
	}
}

/** Stable expiry text. UTC avoids server locale differences in tests. */
function expiryLabel(expiresAt: string | Date): string {
	return new Intl.DateTimeFormat("en-GB", {
		dateStyle: "medium",
		timeZone: "UTC",
	}).format(new Date(expiresAt));
}

export default function OrganizationInvitationEmail({
	url,
	organizationName,
	inviterName,
	role,
	expiresAt,
}: OrganizationInvitationEmailProps) {
	return (
		<Html>
			<Head />
			<Preview>
				{inviterName} invited you to {organizationName} on Handoff
			</Preview>
			<Body style={{ fontFamily: "sans-serif", backgroundColor: "#f5f2e9" }}>
				<Container style={{ padding: "24px" }}>
					<Heading>You have been invited</Heading>
					<Text>
						{inviterName} invited you to join {organizationName} on Handoff as{" "}
						{roleLabel(role)}.
					</Text>
					<Text>
						Handoff is where your team agrees on scope, shares deliverables and
						formally approves work with clients.
					</Text>
					<Section>
						<Link href={url}>Accept invitation</Link>
					</Section>
					<Text>This invitation expires on {expiryLabel(expiresAt)}.</Text>
					<Text>
						If you were not expecting this invitation, you can ignore this
						email. Nothing happens until you accept.
					</Text>
				</Container>
			</Body>
		</Html>
	);
}
