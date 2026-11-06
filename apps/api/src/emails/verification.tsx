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

interface VerificationEmailProps {
	url: string;
}

export default function VerificationEmail({ url }: VerificationEmailProps) {
	return (
		<Html>
			<Head />
			<Preview>Verify your email address for Handoff</Preview>
			<Body style={{ fontFamily: "sans-serif", backgroundColor: "#f5f2e9" }}>
				<Container style={{ padding: "24px" }}>
					<Heading>Verify your email</Heading>
					<Text>
						Thanks for signing up for Handoff. Click the link below to verify
						your email address. This link expires in one hour, and you cannot
						use your account until the address is confirmed.
					</Text>
					<Section>
						<Link href={url}>Verify email</Link>
					</Section>
					<Text>
						If you did not create a Handoff account, ignore this email. The
						address stays unverified and the account cannot be used without this
						link.
					</Text>
				</Container>
			</Body>
		</Html>
	);
}
