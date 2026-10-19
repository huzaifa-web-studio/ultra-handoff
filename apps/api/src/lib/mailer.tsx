import nodemailer from "nodemailer";
import { renderToStaticMarkup } from "react-dom/server";

import ResetPasswordEmail from "../emails/reset-password";
import VerificationEmail from "../emails/verification";

/**
 * Nodemailer transporter for sending transactional emails.
 * Configured via SMTP_* environment variables.
 */
const transporter = nodemailer.createTransport({
	host: process.env.SMTP_HOST ?? "localhost",
	port: Number(process.env.SMTP_PORT ?? 587),
	secure: process.env.SMTP_SECURE === "true",
	auth:
		process.env.SMTP_USER && process.env.SMTP_PASS
			? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
			: undefined,
});

const FROM = process.env.SMTP_FROM ?? "Handoff <[email protected]>";

/**
 * Send a verification email to a newly registered user.
 */
export async function sendVerificationEmail(
	to: string,
	url: string,
): Promise<void> {
	const html = renderToStaticMarkup(<VerificationEmail url={url} />);
	try {
		const info = await transporter.sendMail({
			from: FROM,
			to,
			subject: "Verify your email address",
			html,
		});
		if (process.env.NODE_ENV !== "production") {
			console.log("[mailer] verification sent:", info.messageId, "to", to);
		}
	} catch (err) {
		if (process.env.NODE_ENV !== "production") {
			console.error("[mailer] verification failed:", err);
		}
		throw err;
	}
}

/**
 * Send a password reset email.
 */
export async function sendResetPasswordEmail(
	to: string,
	url: string,
): Promise<void> {
	const html = renderToStaticMarkup(<ResetPasswordEmail url={url} />);
	await transporter.sendMail({
		from: FROM,
		to,
		subject: "Reset your password",
		html,
	});
}
