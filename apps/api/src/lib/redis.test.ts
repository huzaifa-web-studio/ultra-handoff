/**
 * Tests for Redis URL parsing and connection option shape.
 *
 * Why: the Redis outage fix depends on two things that are easy to regress and
 * hard to notice: URL credentials actually reaching the client, and our client
 * keeping the fail fast options while BullMQ keeps the permissive ones. No
 * socket is opened here, so the test runs without a Redis server.
 */

import { describe, expect, it } from "bun:test";

import {
	formatRedisIssue,
	parseRedisUrl,
	redisClientOptions,
	redisConnectionOptions,
	resolveRedisAuth,
} from "./redis";

describe("parseRedisUrl", () => {
	it("reads host and port", () => {
		expect(parseRedisUrl("redis://cache:6380")).toEqual({
			host: "cache",
			port: 6380,
			username: undefined,
			password: undefined,
		});
	});

	it("defaults to port 6379", () => {
		expect(parseRedisUrl("redis://cache").port).toBe(6379);
	});

	it("reads a password only userinfo", () => {
		const parts = parseRedisUrl("redis://:secret@cache:6379");

		expect(parts.username).toBeUndefined();
		expect(parts.password).toBe("secret");
	});

	it("decodes percent encoded credentials", () => {
		const parts = parseRedisUrl("redis://app:p%40ss%3Aword@cache:6379");

		expect(parts.username).toBe("app");
		expect(parts.password).toBe("p@ss:word");
	});
});

describe("resolveRedisAuth", () => {
	const parts = parseRedisUrl("redis://urluser:urlpass@cache:6379");

	it("prefers the explicit environment password", () => {
		expect(resolveRedisAuth(parts, "envpass").password).toBe("envpass");
	});

	it("falls back to the URL password when the environment is empty", () => {
		expect(resolveRedisAuth(parts, undefined).password).toBe("urlpass");
	});

	it("always takes the username from the URL", () => {
		expect(resolveRedisAuth(parts, "envpass").username).toBe("urluser");
	});
});

describe("connection option split", () => {
	it("keeps the application client failing fast", () => {
		expect(redisClientOptions.enableOfflineQueue).toBe(false);
		expect(redisClientOptions.maxRetriesPerRequest).toBe(1);
		expect(redisClientOptions.commandTimeout).toBeGreaterThan(0);
		expect(redisClientOptions.connectTimeout).toBeGreaterThan(0);
	});

	it("leaves BullMQ's offline queue and retry budget at the library default", () => {
		// BullMQ depends on both. Adding the application deadlines here would
		// abort its blocking reads, which is why the options are not shared.
		expect("enableOfflineQueue" in redisConnectionOptions).toBe(false);
		expect("commandTimeout" in redisConnectionOptions).toBe(false);
		expect("maxRetriesPerRequest" in redisConnectionOptions).toBe(false);
	});
});

describe("formatRedisIssue", () => {
	it("includes the key and the error message", () => {
		const line = formatRedisIssue("ping", new Error("connect ECONNREFUSED"));

		expect(line).toContain("ping");
		expect(line).toContain("connect ECONNREFUSED");
	});

	it("stays on one line with no stack", () => {
		const line = formatRedisIssue("ping", new Error("boom"));

		expect(line).not.toContain("\n");
		expect(line).not.toContain("    at ");
	});

	it("reads a non-Error value", () => {
		expect(formatRedisIssue("ping", "boom")).toBe("[redis] ping failed: boom");
	});

	it("includes the ioredis code when present", () => {
		const error = Object.assign(new Error("connect ECONNREFUSED"), {
			code: "ECONNREFUSED",
		});

		expect(formatRedisIssue("ping", error)).toBe(
			"[redis] ping failed (ECONNREFUSED): connect ECONNREFUSED",
		);
	});

	it("does not print undefined for a missing code", () => {
		expect(formatRedisIssue("ping", new Error("boom"))).toBe(
			"[redis] ping failed: boom",
		);
	});
});
