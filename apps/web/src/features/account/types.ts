/**
 * Shared account types.
 *
 * Kept separate from the components so the page and the cards agree on the
 * shape without importing each other.
 *
 * Used by: src/routes/_app/account.tsx and the account feature cards.
 */

export type AccountUser = {
	id: string;
	name: string;
	email: string;
	emailVerified: boolean;
	image?: string | null;
};
