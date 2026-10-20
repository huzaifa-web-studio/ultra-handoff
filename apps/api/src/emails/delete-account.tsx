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

interface DeleteAccountEmailProps {
	url: string;
}

/**
 * Confirmation email for account deletion.
 *
 * Why: Better Auth cannot delete an OAuth-only account without proof that the
 * request came from the account owner. The generated link carries that proof.
 *
 * Used by: sendDeleteAccountEmail in src/lib/mailer.tsx, triggered by the
 * `sendDeleteAccountVerification` callback in src/auth/auth.ts.
 */
export default function DeleteAccountEmail({ url }: DeleteAccountEmailProps) {
	return (
		<Html>
			<Head />
			<Preview>Confirm your Handoff account deletion</Preview>
			<Body style={{ fontFamily: "sans-serif", backgroundColor: "#f5f2e9" }}>
				<Container style={{ padding: "24px" }}>
					<Heading>Confirm account deletion</Heading>
					<Text>
						We received a request to permanently delete your Handoff account.
						This cannot be undone.
					</Text>
					<Text>
						Your profile, avatar, linked sign-in methods and organization
						memberships will be removed.
					</Text>
					<Section>
						<Link href={url}>Delete my account</Link>
					</Section>
					<Text>
						Open this link in the browser where you are signed in to Handoff.
						The link confirms the request and then takes you back to the app.
					</Text>
					<Text>
						If you did not request this, ignore this email. Your account stays
						active and nothing changes.
					</Text>
				</Container>
			</Body>
		</Html>
	);
}
