import nodemailer from "nodemailer";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import DeleteAccountEmail from "../emails/delete-account";
import MagicLinkEmail from "../emails/magic-link";
import OrganizationInvitationEmail from "../emails/organization-invitation";
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

/**
 * Payload stored in Redis by the email queue.
 *
 * A discriminated union, not a loose object: an invitation email without the
 * organization name would fail at compile time instead of rendering "undefined"
 * in someone's inbox. Only the recipient, the template and the template's own
 * fields are stored. Subjects and bodies are resolved locally, so a queued
 * payload cannot choose an arbitrary subject.
 */
export type EmailJobData =
	| { to: string; template: "verification"; url: string }
	| { to: string; template: "reset-password"; url: string }
	| { to: string; template: "delete-account"; url: string }
	| {
			to: string;
			template: "organization-invitation";
			url: string;
			organizationName: string;
			inviterName: string;
			role: string;
			/**
			 * BullMQ serialises the payload to JSON, so a queued job carries a
			 * string. An in-process render can still receive a Date.
			 */
			expiresAt: string | Date;
	  }
	| { to: string; template: "magic-link"; url: string };

/** Every transactional email the API can queue. */
export type EmailTemplate = EmailJobData["template"];

/** Render one element without repeating the static markup call. */
function renderElement(element: ReactElement): string {
	return renderToStaticMarkup(element);
}

/**
 * Render one queued email to HTML.
 *
 * A switch instead of a registry so the payload type narrows on every branch:
 * the invitation template can only read invitation fields, and the magic link
 * template cannot accidentally receive an organization name. Subjects live
 * here, next to their component, so copy changes stay in one file.
 *
 * Exported separately from delivery so a template can be rendered without an
 * SMTP connection, which keeps the render path easy to inspect.
 */
export function renderEmail(job: EmailJobData): {
	subject: string;
	html: string;
} {
	switch (job.template) {
		case "verification":
			return {
				subject: "Verify your email address",
				html: renderElement(<VerificationEmail url={job.url} />),
			};
		case "reset-password":
			return {
				subject: "Reset your password",
				html: renderElement(<ResetPasswordEmail url={job.url} />),
			};
		case "delete-account":
			return {
				subject: "Confirm your account deletion",
				html: renderElement(<DeleteAccountEmail url={job.url} />),
			};
		case "organization-invitation":
			return {
				subject: `${job.inviterName} invited you to ${job.organizationName} on Handoff`,
				html: renderElement(
					<OrganizationInvitationEmail
						url={job.url}
						organizationName={job.organizationName}
						inviterName={job.inviterName}
						role={job.role}
						expiresAt={job.expiresAt}
					/>,
				),
			};
		case "magic-link":
			return {
				subject: "Your Handoff sign-in link",
				html: renderElement(<MagicLinkEmail url={job.url} />),
			};
	}
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
