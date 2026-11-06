/**
 * Protocol contract tests.
 *
 * The inbound parser is the only place a client can influence the server, so it
 * gets explicit coverage for every rejection path. The envelope check covers
 * Redis, which is outside TypeScript and can hand back anything.
 */

import { describe, expect, it } from "bun:test";

import {
	createRealtimeEnvelope,
	parseInboundMessage,
	parseRealtimeEnvelope,
	projectTopic,
	REALTIME_PROTOCOL_VERSION,
	type RealtimeEnvelope,
} from "./protocol";

describe("realtime protocol", () => {
	it("builds a versioned envelope", () => {
		const envelope = createRealtimeEnvelope("project-1", "system.ready", {
			ok: true,
		});

		expect(envelope.v).toBe(REALTIME_PROTOCOL_VERSION);
		expect(envelope.projectId).toBe("project-1");
		expect(envelope.type).toBe("system.ready");
		expect(envelope.id.length).toBeGreaterThan(0);
		expect(Number.isNaN(Date.parse(envelope.at))).toBe(false);
	});

	it("names one topic per project", () => {
		expect(projectTopic("project-1")).toBe("project:project-1");
		expect(projectTopic("project-1")).not.toBe(projectTopic("project-2"));
	});
});

describe("parseInboundMessage", () => {
	it("accepts a ping without a version", () => {
		expect(parseInboundMessage('{"type":"ping"}')).toEqual({ type: "ping" });
	});

	it("accepts a ping at the current version", () => {
		expect(
			parseInboundMessage(
				JSON.stringify({ v: REALTIME_PROTOCOL_VERSION, type: "ping" }),
			),
		).toEqual({ type: "ping" });
	});

	it("accepts a milestone scoped presence frame", () => {
		expect(
			parseInboundMessage(
				'{"v":1,"type":"presence.join","milestoneId":"milestone-1"}',
			),
		).toEqual({ type: "presence.join", milestoneId: "milestone-1" });
	});

	it("accepts an already parsed object frame", () => {
		// Elysia's default parser decodes a JSON object before the handler runs.
		expect(parseInboundMessage({ v: 1, type: "ping" })).toEqual({
			type: "ping",
		});
		expect(
			parseInboundMessage({
				v: 1,
				type: "presence.join",
				milestoneId: "milestone-1",
			}),
		).toEqual({ type: "presence.join", milestoneId: "milestone-1" });
	});

	it("rejects a parsed object of an unsupported type", () => {
		expect(parseInboundMessage({ v: 1, type: "nope" })).toBeNull();
	});

	it("rejects malformed json", () => {
		expect(parseInboundMessage("not json")).toBeNull();
		expect(parseInboundMessage("")).toBeNull();
	});

	it("rejects a non object frame", () => {
		expect(parseInboundMessage('"ping"')).toBeNull();
		expect(parseInboundMessage("[]")).toBeNull();
		expect(parseInboundMessage("null")).toBeNull();
	});

	it("rejects another protocol version", () => {
		expect(parseInboundMessage('{"v":2,"type":"ping"}')).toBeNull();
	});

	it("rejects an unknown type", () => {
		expect(parseInboundMessage('{"type":"comment.delete"}')).toBeNull();
	});

	it("rejects a presence frame without a usable milestone id", () => {
		expect(parseInboundMessage('{"type":"presence.join"}')).toBeNull();
		expect(
			parseInboundMessage('{"type":"presence.join","milestoneId":""}'),
		).toBeNull();
		expect(
			parseInboundMessage(
				JSON.stringify({
					type: "presence.join",
					milestoneId: "x".repeat(65),
				}),
			),
		).toBeNull();
	});
});

describe("parseRealtimeEnvelope", () => {
	const valid: RealtimeEnvelope = {
		v: REALTIME_PROTOCOL_VERSION,
		id: "event-1",
		type: "milestone.updated",
		at: new Date().toISOString(),
		projectId: "project-1",
		data: {},
	};

	it("accepts a well formed envelope", () => {
		expect(parseRealtimeEnvelope(valid)).toEqual(valid);
	});

	it("rejects a mismatched version", () => {
		expect(parseRealtimeEnvelope({ ...valid, v: 2 })).toBeNull();
	});

	it("rejects a missing project id", () => {
		expect(parseRealtimeEnvelope({ ...valid, projectId: "" })).toBeNull();
		expect(
			parseRealtimeEnvelope({ ...valid, projectId: undefined }),
		).toBeNull();
	});

	it("rejects a missing type", () => {
		expect(parseRealtimeEnvelope({ ...valid, type: undefined })).toBeNull();
	});

	it("rejects a non object payload", () => {
		expect(parseRealtimeEnvelope(null)).toBeNull();
		expect(parseRealtimeEnvelope("event")).toBeNull();
		expect(parseRealtimeEnvelope([])).toBeNull();
	});
});
