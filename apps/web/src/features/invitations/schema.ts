/**
 * Bulk invite input parsing.
 *
 * Why client side validation: the dialog has to tell someone which line is
 * wrong before a request is sent, and show how many addresses will actually be
 * invited. The API validates the same rules again and remains authoritative,
 * including limits the browser cannot know (seats, pending invitations).
 *
 * Used by: features/invitations/invite-members-dialog.tsx.
 */

/** Deliberately simple. The server uses the same shape. */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Mirrors BULK_INVITE_MAX in the API. */
export const MAX_BULK_INVITES = 25;

export type EmailEntryState = "valid" | "invalid" | "duplicate";

export type EmailEntry = {
	email: string;
	state: EmailEntryState;
};

export type ParsedEmails = {
	entries: EmailEntry[];
	valid: string[];
	invalidCount: number;
	duplicateCount: number;
};

/**
 * Split on commas, semicolons and whitespace.
 *
 * People paste from spreadsheets and email clients, so all three separators
 * have to work. Empty fragments are ignored.
 */
export function splitEmails(input: string): string[] {
	return input
		.split(/[\s,;]+/)
		.map((value) => value.trim())
		.filter(Boolean);
}

/**
 * Classify every pasted address once, in order.
 *
 * Lowercasing here matches the API's normalisation, so `A@x.com` and `a@x.com`
 * are reported as one duplicate instead of two invitations for one inbox.
 */
export function parseEmailInput(input: string): ParsedEmails {
	const seen = new Set<string>();
	const entries: EmailEntry[] = [];
	const valid: string[] = [];
	let invalidCount = 0;
	let duplicateCount = 0;

	for (const raw of splitEmails(input)) {
		const email = raw.toLowerCase();

		if (!EMAIL_PATTERN.test(email) || email.length > 254) {
			entries.push({ email: raw, state: "invalid" });
			invalidCount += 1;
			continue;
		}

		if (seen.has(email)) {
			entries.push({ email, state: "duplicate" });
			duplicateCount += 1;
			continue;
		}

		seen.add(email);
		entries.push({ email, state: "valid" });
		valid.push(email);
	}

	return { entries, valid, invalidCount, duplicateCount };
}
