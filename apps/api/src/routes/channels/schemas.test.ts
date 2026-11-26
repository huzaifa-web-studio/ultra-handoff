/**
 * Channel route schema tests.
 *
 * Why: `t.UnionEnum` injects its first value as a default. In the channel
 * routes that once made `visibility` default to `"public"` and `role` default
 * to `"owner"`, so an omitted field could widen a private channel or promote a
 * member. These tests pin the corrected behaviour at the HTTP boundary, where
 * the bug actually appeared.
 *
 * Used by: the API test suite.
 */

import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";

import {
	browseQuery,
	createChannelBody,
	updateChannelBody,
	updateMemberBody,
} from "./schemas";

const app = new Elysia()
	.post("/create", ({ body }) => body, { body: createChannelBody })
	.patch("/update", ({ body }) => body, { body: updateChannelBody })
	.patch("/role", ({ body }) => body, { body: updateMemberBody })
	.get("/browse", ({ query }) => query, { query: browseQuery });

async function call(
	method: "GET" | "POST" | "PATCH",
	path: string,
	body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
	const response = await app.handle(
		new Request(`http://localhost${path}`, {
			method,
			headers: { "content-type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body),
		}),
	);

	return {
		status: response.status,
		body: (await response.json()) as Record<string, unknown>,
	};
}

describe("createChannelBody", () => {
	it("rejects a create without visibility", async () => {
		const result = await call("POST", "/create", { title: "design" });

		expect(result.status).toBe(422);
	});

	it("keeps an explicit private visibility", async () => {
		const result = await call("POST", "/create", {
			title: "design",
			visibility: "private",
		});

		expect(result.status).toBe(200);
		expect(result.body.visibility).toBe("private");
	});
});

describe("updateChannelBody", () => {
	it("does not invent a visibility when the body is empty", async () => {
		const result = await call("PATCH", "/update", {});

		expect(result.status).toBe(200);
		expect(result.body).toEqual({});
	});

	it("does not invent a visibility when only the title changes", async () => {
		const result = await call("PATCH", "/update", { title: "renamed" });

		expect(result.status).toBe(200);
		expect(result.body).toEqual({ title: "renamed" });
	});

	it("keeps an explicit visibility", async () => {
		const result = await call("PATCH", "/update", { visibility: "private" });

		expect(result.status).toBe(200);
		expect(result.body).toEqual({ visibility: "private" });
	});
});

describe("updateMemberBody", () => {
	it("rejects a role change with no role", async () => {
		const result = await call("PATCH", "/role", {});

		expect(result.status).toBe(422);
	});

	it("keeps an explicit member role", async () => {
		const result = await call("PATCH", "/role", { role: "member" });

		expect(result.status).toBe(200);
		expect(result.body).toEqual({ role: "member" });
	});
});

describe("browseQuery", () => {
	it("accepts a cursor and a search term", async () => {
		const result = await call("GET", "/browse?search=design&cursor=abc");

		expect(result.status).toBe(200);
		expect(result.body).toEqual({ search: "design", cursor: "abc" });
	});
});
