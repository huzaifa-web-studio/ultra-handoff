/**
 * Tests for the SSRF allowlist.
 *
 * Why a table: the failure mode of this module is silent. A wrong answer does
 * not crash, it fetches somewhere it should not. Every textual form of a
 * private address is listed here so a regression is caught immediately.
 *
 * Run with: bun test
 */

import { describe, expect, test } from "bun:test";

import {
	canonicalizeUrl,
	hashUrl,
	isBlockedAddress,
	isPreviewableUrl,
	normalizeHostname,
	parsePreviewUrl,
	resolvePreviewTarget,
} from "./url";

describe("parsePreviewUrl", () => {
	test.each([
		["https://example.com", true],
		["http://example.com/path?q=1", true],
		["https://sub.example.co.uk/a", true],
		// Schemes that must never be fetched.
		["javascript:alert(1)", false],
		["data:text/html,<h1>x</h1>", false],
		["file:///etc/passwd", false],
		["ftp://example.com", false],
		// Credentials in the URL.
		["https://user:pass@example.com", false],
		["https://user@example.com", false],
		// Ports other than the protocol default.
		["https://example.com:8443", false],
		["http://example.com:8080", false],
		["https://example.com:80", false],
		// Single label hosts are internal names, not pages.
		["http://intranet", false],
		["http://localhost:3000", false],
		// Local suffixes.
		["http://printer.local", false],
		["http://service.internal", false],
		["http://x.home.arpa", false],
		// Malformed.
		["", false],
		["not a url", false],
		[`https://${"a".repeat(3000)}.com`, false],
	])("%s is allowed: %p", (input, allowed) => {
		expect(parsePreviewUrl(input) !== null).toBe(allowed);
	});
});

describe("isBlockedAddress", () => {
	test.each([
		// IPv4 private, loopback, link local, CGNAT, multicast, reserved.
		["0.0.0.0", true],
		["10.1.2.3", true],
		["100.64.0.1", true],
		["127.0.0.1", true],
		["169.254.169.254", true],
		["172.16.0.1", true],
		["172.31.255.255", true],
		["192.168.1.1", true],
		["198.18.0.1", true],
		["224.0.0.1", true],
		["240.0.0.1", true],
		["255.255.255.255", true],
		// IPv6 loopback, unique local, link local, multicast, documentation.
		["::1", true],
		["fd00::1", true],
		["fe80::1", true],
		["ff02::1", true],
		["2001:db8::1", true],
		["::", true],
		// IPv4 mapped forms.
		["::ffff:7f00:1", true],
		["::ffff:127.0.0.1", true],
		["::ffff:a00:1", true],
		// Public addresses must pass, or every preview would be blocked.
		["8.8.8.8", false],
		["1.1.1.1", false],
		["93.184.216.34", false],
		["2001:4860:4860::8888", false],
		["::ffff:808:808", false],
		// Not an address at all.
		["not-an-ip", true],
	])("%s is blocked: %p", (address, blocked) => {
		expect(isBlockedAddress(address)).toBe(blocked);
	});
});

describe("resolvePreviewTarget", () => {
	test("rejects the cloud metadata endpoint without a network call", async () => {
		const result = await resolvePreviewTarget(
			"http://169.254.169.254/latest/meta-data/",
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe("blocked");
	});

	test("rejects localhost after resolution", async () => {
		const result = await resolvePreviewTarget("http://localhost/");
		expect(result.ok).toBe(false);
	});
});

describe("canonical form", () => {
	test("drops the fragment, lowercases the host and the default port", () => {
		const parsed = parsePreviewUrl("https://WWW.Example.COM:443/Path?q=1#frag");
		expect(parsed).not.toBeNull();
		expect(parsed ? canonicalizeUrl(parsed) : "").toBe(
			"https://www.example.com/Path?q=1",
		);
	});

	test("keeps the query, because it can change the page", () => {
		const parsed = parsePreviewUrl("https://example.com/a?b=1");
		expect(parsed ? canonicalizeUrl(parsed) : "").toBe(
			"https://example.com/a?b=1",
		);
	});

	test("two spellings of the same page hash the same", () => {
		const a = parsePreviewUrl("https://example.com/a#one");
		const b = parsePreviewUrl("https://EXAMPLE.com/a#two");

		expect(a && b).toBeTruthy();
		if (!a || !b) return;

		expect(hashUrl(canonicalizeUrl(a))).toBe(hashUrl(canonicalizeUrl(b)));
	});
});

describe("helpers", () => {
	test("normalizeHostname strips the trailing dot", () => {
		expect(normalizeHostname("Example.COM.")).toBe("example.com");
	});

	test("isPreviewableUrl mirrors the parser", () => {
		expect(isPreviewableUrl("https://example.com")).toBe(true);
		expect(isPreviewableUrl("javascript:alert(1)")).toBe(false);
	});
});
