import nodemailer from "nodemailer";
import { renderToStaticMarkup } from "react-dom/server";

import ResetPasswordEmail from "../emails/reset-password";
import VerificationEmail from "../emails/verification";
import { isProduction, smtpEnv } from "./env";

/**
 * Nodemailer transporter for sending transactional emails.
 * Configured via SMTP_* environment variables.
 */
const transporter = nodemailer.createTransport({
	host: smtpEnv.host,
	port: smtpEnv.port,
	secure: smtpEnv.secure,
	auth:
		smtpEnv.user && smtpEnv.pass
			? { user: smtpEnv.user, pass: smtpEnv.pass }
			: undefined,
});

const FROM = smtpEnv.from;

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
		if (!isProduction) {
			console.log("[mailer] verification sent:", info.messageId, "to", to);
		}
	} catch (err) {
		if (!isProduction) {
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
