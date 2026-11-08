/**
 * Shared password policy.
 *
 * Why these exist: four auth endpoints rely on this one expression. A change to
 * it can silently weaken sign-up, reset, change and set password at once, so
 * every class requirement and both bounds are pinned here.
 *
 * Run with: bun test
 */

import { describe, expect, test } from "bun:test";

import {
	isValidPassword,
	PASSWORD_MAX,
	PASSWORD_MIN,
	passwordRegex,
	passwordRuleMessage,
} from "./password";

describe("isValidPassword", () => {
	test("accepts a password with all four classes at the minimum length", () => {
		expect(isValidPassword("Abcdef1!")).toBe(true);
	});

	test("accepts a long password", () => {
		expect(isValidPassword(`${"Aa1!".repeat(32)}`)).toBe(true);
	});

	test("rejects a password below the minimum length", () => {
		expect(isValidPassword("Ab1!")).toBe(false);
	});

	test("rejects a password above the maximum length", () => {
		const tooLong = `Aa1!${"a".repeat(PASSWORD_MAX)}`;
		expect(tooLong.length).toBeGreaterThan(PASSWORD_MAX);
		expect(isValidPassword(tooLong)).toBe(false);
	});

	test("requires lowercase, uppercase, a digit and a symbol", () => {
		expect(isValidPassword("abcdef1!")).toBe(false);
		expect(isValidPassword("ABCDEF1!")).toBe(false);
		expect(isValidPassword("Abcdefg!")).toBe(false);
		expect(isValidPassword("Abcdef12")).toBe(false);
	});

	test("treats whitespace and unicode symbols as symbols", () => {
		expect(isValidPassword("Abcdef1 ")).toBe(true);
		expect(isValidPassword("Abcdef1€")).toBe(true);
	});
});

describe("policy constants", () => {
	test("the message quotes the same bounds as the expression", () => {
		expect(passwordRuleMessage).toContain(`${PASSWORD_MIN}`);
		expect(passwordRuleMessage).toContain(`${PASSWORD_MAX}`);
	});

	test("the regex is anchored at both ends", () => {
		expect(passwordRegex.source.startsWith("^")).toBe(true);
		expect(passwordRegex.source.endsWith("$")).toBe(true);
	});
});
