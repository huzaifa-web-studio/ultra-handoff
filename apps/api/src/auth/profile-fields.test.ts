/**
 * Profile field validation.
 *
 * Why a unit test: these three validators are the only server side guard for the
 * optional profile text. They must trim, store empty as null and reject an
 * oversized value before it reaches Postgres.
 */

import { describe, expect, test } from "bun:test";

import {
	bioField,
	jobTitleField,
	locationField,
	PROFILE_JOB_TITLE_MAX,
	PROFILE_LOCATION_MAX,
} from "./profile-fields";

/** Read the value or the first issue message from one validation. */
function check(
	field: {
		"~standard": { validate: (value: unknown) => unknown };
	},
	value: unknown,
) {
	return field["~standard"].validate(value) as
		| { value: string | null }
		| { issues: Array<{ message: string }> };
}

describe("profile fields", () => {
	test("trims a value before storing it", () => {
		expect(check(jobTitleField, "  Product designer  ")).toEqual({
			value: "Product designer",
		});
	});

	test("stores an empty value as null", () => {
		expect(check(locationField, "   ")).toEqual({ value: null });
	});

	test("stores a missing value as null", () => {
		expect(check(bioField, undefined)).toEqual({ value: null });
		expect(check(bioField, null)).toEqual({ value: null });
	});

	test("rejects a value that is too long", () => {
		const result = check(jobTitleField, "a".repeat(PROFILE_JOB_TITLE_MAX + 1));

		expect("issues" in result).toBe(true);
	});

	test("accepts a value at the limit", () => {
		const value = "a".repeat(PROFILE_LOCATION_MAX);

		expect(check(locationField, value)).toEqual({ value });
	});

	test("rejects a non text value", () => {
		const result = check(bioField, 42);

		expect("issues" in result).toBe(true);
	});
});
