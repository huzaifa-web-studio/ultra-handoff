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

interface ResetPasswordEmailProps {
	url: string;
}

export default function ResetPasswordEmail({ url }: ResetPasswordEmailProps) {
	return (
		<Html>
			<Head />
			<Preview>Reset your Handoff password</Preview>
			<Body style={{ fontFamily: "sans-serif", backgroundColor: "#f5f2e9" }}>
				<Container style={{ padding: "24px" }}>
					<Heading>Reset your password</Heading>
					<Text>
						We received a request to reset your Handoff password. Click the link
						below to choose a new password.
					</Text>
					<Section>
						<Link href={url}>Reset password</Link>
					</Section>
					<Text>This link expires in one hour.</Text>
					<Text>If you did not request this, you can ignore this email.</Text>
				</Container>
			</Body>
		</Html>
	);
}
