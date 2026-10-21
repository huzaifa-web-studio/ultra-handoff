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
 * Passwordless sign-in email.
 *
 * Why: invited users can accept without inventing a password. The link is
 * single use, expires in ten minutes and always arrives at the invitation's
 * own address, so the person who controls the inbox is the person who signs in.
 *
 * Used by: src/lib/mailer.tsx when the magic link plugin sends a token.
 */

interface MagicLinkEmailProps {
	url: string;
}

export default function MagicLinkEmail({ url }: MagicLinkEmailProps) {
	return (
		<Html>
			<Head />
			<Preview>Your Handoff sign-in link</Preview>
			<Body style={{ fontFamily: "sans-serif", backgroundColor: "#f5f2e9" }}>
				<Container style={{ padding: "24px" }}>
					<Heading>Sign in to Handoff</Heading>
					<Text>
						Click the link below to sign in and continue with the invitation.
					</Text>
					<Section>
						<Link href={url}>Sign in to Handoff</Link>
					</Section>
					<Text>
						This link expires in ten minutes and can only be used once.
					</Text>
					<Text>
						If you did not request this, you can ignore this email. No one can
						sign in without opening the link.
					</Text>
				</Container>
			</Body>
		</Html>
	);
}
