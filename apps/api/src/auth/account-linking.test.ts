/**
 * Account linking policy.
 *
 * Why this exists: the takeover case is a pre-registered, unverified local row
 * at a victim's address. Better Auth already refuses to link an OAuth identity
 * into such a row through `requireLocalEmailVerified`. Pinning it here keeps
 * that protection explicit while leaving implicit linking on, so a verified
 * password user can still sign in with Google or GitHub.
 *
 * Run with: bun test
 */

import { describe, expect, test } from "bun:test";

import { ACCOUNT_LINKING_OPTIONS } from "./account-linking";

describe("ACCOUNT_LINKING_OPTIONS", () => {
	test("requires the local address to be verified before implicit linking", () => {
		expect(ACCOUNT_LINKING_OPTIONS.requireLocalEmailVerified).toBe(true);
	});

	test("keeps implicit linking available for verified users", () => {
		expect(ACCOUNT_LINKING_OPTIONS.enabled).toBe(true);
		expect(ACCOUNT_LINKING_OPTIONS.trustedProviders).toEqual([
			"github",
			"google",
		]);
	});
});
