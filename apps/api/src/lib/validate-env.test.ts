/**
 * Tests for the production environment gate.
 *
 * Why: the whole point of Batch 4 is that a deployment cannot silently inherit
 * a development value. These tests pin the rule so a future edit to the
 * required list or the URL check fails here, not in a deployment.
 *
 * Used by: src/lib/validate-env.ts.
 */

import { describe, expect, test } from "bun:test";

import { assertProductionEnv, findProductionEnvProblems } from "./validate-env";

/** A complete production environment. Individual tests remove one value. */
const completeEnv = {
	NODE_ENV: "production",
	DATABASE_URL: "postgres://app:secret@postgres:5432/app",
	DATABASE_APP_URL: "postgres://app_tenant:secret@postgres:5432/app",
	BETTER_AUTH_SECRET: "long-random-secret",
	BETTER_AUTH_URL: "https://api.example.com",
	WEB_URL: "https://app.example.com",
	REDIS_URL: "redis://redis:6379",
	S3_ACCESS_KEY: "access-key",
	S3_SECRET_KEY: "secret-key",
	S3_PUBLIC_ENDPOINT: "https://storage.example.com",
	SMTP_HOST: "smtp.example.com",
	SMTP_FROM: "Handoff <no-reply@example.com>",
} as const;

describe("findProductionEnvProblems", () => {
	test("accepts a complete production environment", () => {
		expect(findProductionEnvProblems(completeEnv)).toEqual([]);
	});

	test("treats an unset NODE_ENV as production", () => {
		// A bare binary must fail closed, so an absent flag is not development.
		const problems = findProductionEnvProblems({});

		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain("missing:");
		expect(problems[0]).toContain("DATABASE_URL");
	});

	test("skips the check in development and test", () => {
		expect(findProductionEnvProblems({ NODE_ENV: "development" })).toEqual([]);
		expect(findProductionEnvProblems({ NODE_ENV: "test" })).toEqual([]);
	});

	test("counts whitespace as missing", () => {
		const problems = findProductionEnvProblems({
			...completeEnv,
			BETTER_AUTH_SECRET: "   ",
		});

		expect(problems).toEqual(["missing: BETTER_AUTH_SECRET"]);
	});

	test("lists every missing variable in one error", () => {
		const problems = findProductionEnvProblems({ NODE_ENV: "production" });

		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain("DATABASE_URL");
		expect(problems[0]).toContain("S3_PUBLIC_ENDPOINT");
	});

	test("rejects a public URL that is not absolute http(s)", () => {
		const problems = findProductionEnvProblems({
			...completeEnv,
			WEB_URL: "app.example.com",
		});

		expect(problems).toEqual(["not an absolute http(s) URL: WEB_URL"]);
	});

	test("reports a missing sender address", () => {
		const problems = findProductionEnvProblems({
			...completeEnv,
			SMTP_FROM: undefined,
		});

		expect(problems).toEqual(["missing: SMTP_FROM"]);
	});

	test("rejects a sender address without @", () => {
		// A name only value boots a healthy API that cannot send any mail.
		const problems = findProductionEnvProblems({
			...completeEnv,
			SMTP_FROM: "Handoff",
		});

		expect(problems).toEqual([
			"not a mailbox address (must contain @): SMTP_FROM",
		]);
	});

	test("rejects the same URL for the owner and tenant roles", () => {
		const problems = findProductionEnvProblems({
			...completeEnv,
			DATABASE_APP_URL: completeEnv.DATABASE_URL,
		});

		expect(problems[0]).toContain("DATABASE_APP_URL must not equal");
	});
});

describe("assertProductionEnv", () => {
	test("passes a complete production environment", () => {
		expect(() => assertProductionEnv(completeEnv)).not.toThrow();
	});

	test("throws one actionable message when values are missing", () => {
		expect(() => assertProductionEnv({ NODE_ENV: "production" })).toThrow(
			/Refusing to start in production.*missing:/,
		);
	});
});
