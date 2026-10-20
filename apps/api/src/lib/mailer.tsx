import nodemailer from "nodemailer";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import DeleteAccountEmail from "../emails/delete-account";
import ResetPasswordEmail from "../emails/reset-password";
import VerificationEmail from "../emails/verification";
import { isProduction, smtpEnv } from "./env";

/**
 * Transactional email rendering and SMTP delivery.
 *
 * Why: rendering and delivery are the worker's job, not the request path. The
 * Better Auth callbacks only queue a job, and the email worker calls
 * `deliverEmail` so a slow or failing SMTP server cannot stall a sign up.
 *
 * Used by: src/queues/email.ts (worker).
 */

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

/** Every transactional email the API can queue. */
export type EmailTemplate =
	| "verification"
	| "reset-password"
	| "delete-account";

/**
 * Payload stored in Redis by the email queue.
 *
 * Only the recipient, the template name and the link are stored. The subject
 * and body are resolved from the local template registry, so a queued payload
 * cannot choose an arbitrary subject.
 */
export type EmailJobData = {
	to: string;
	template: EmailTemplate;
	url: string;
};

type EmailDefinition = {
	subject: string;
	render: (url: string) => ReactElement;
};

/**
 * Template registry.
 *
 * Subjects live here, next to the component, so copy changes stay in one file.
 */
const TEMPLATES = {
	verification: {
		subject: "Verify your email address",
		render: (url: string) => <VerificationEmail url={url} />,
	},
	"reset-password": {
		subject: "Reset your password",
		render: (url: string) => <ResetPasswordEmail url={url} />,
	},
	"delete-account": {
		subject: "Confirm your account deletion",
		render: (url: string) => <DeleteAccountEmail url={url} />,
	},
} satisfies Record<EmailTemplate, EmailDefinition>;

/**
 * Render one queued email to HTML.
 *
 * Exported separately from delivery so a template can be rendered without an
 * SMTP connection, which keeps the render path easy to inspect.
 */
export function renderEmail(job: EmailJobData): {
	subject: string;
	html: string;
} {
	const definition = TEMPLATES[job.template];

	return {
		subject: definition.subject,
		html: renderToStaticMarkup(definition.render(job.url)),
	};
}

/**
 * Send one queued email.
 *
 * Rethrows on failure on purpose: the worker turns that into a BullMQ retry
 * with exponential backoff. Swallowing the error would drop the message.
 */
export async function deliverEmail(job: EmailJobData): Promise<void> {
	const { subject, html } = renderEmail(job);

	try {
		const info = await transporter.sendMail({
			from: FROM,
			to: job.to,
			subject,
			html,
		});

		if (!isProduction) {
			console.log("[mailer]", job.template, "sent:", info.messageId);
		}
	} catch (error) {
		if (!isProduction) {
			console.error("[mailer]", job.template, "failed:", error);
		}

		throw error;
	}
}
