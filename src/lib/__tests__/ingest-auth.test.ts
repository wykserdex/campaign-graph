import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { extractApiKey, hashApiKey } from "@/lib/ingest/auth";

describe("hashApiKey", () => {
  it("produces the same SHA-256 hex digest the tenants route stores", () => {
    const rawKey = "sk_until-phish_deadbeef";
    const expected = createHash("sha256").update(rawKey).digest("hex");

    expect(hashApiKey(rawKey)).toBe(expected);
    expect(hashApiKey(rawKey)).toHaveLength(64);
  });

  it("never returns the plaintext key", () => {
    const rawKey = "sk_leak-intelligence_supersecret";
    expect(hashApiKey(rawKey)).not.toContain("supersecret");
  });

  it("is sensitive to a single character change", () => {
    expect(hashApiKey("sk_a_1")).not.toBe(hashApiKey("sk_a_2"));
  });
});

describe("extractApiKey", () => {
  it("reads a Bearer token regardless of header case", () => {
    expect(
      extractApiKey(new Headers({ Authorization: "Bearer sk_test_123" }))
    ).toBe("sk_test_123");

    expect(
      extractApiKey(new Headers({ Authorization: "bearer sk_test_123" }))
    ).toBe("sk_test_123");
  });

  it("falls back to X-API-Key", () => {
    expect(extractApiKey(new Headers({ "X-API-Key": "sk_test_456" }))).toBe(
      "sk_test_456"
    );
  });

  it("prefers Authorization over X-API-Key when both are present", () => {
    const headers = new Headers({
      Authorization: "Bearer sk_from_auth",
      "X-API-Key": "sk_from_header",
    });
    expect(extractApiKey(headers)).toBe("sk_from_auth");
  });

  it("returns null when no credential is supplied", () => {
    expect(extractApiKey(new Headers())).toBeNull();
  });

  it("returns null for an empty or whitespace-only credential", () => {
    expect(extractApiKey(new Headers({ Authorization: "Bearer    " }))).toBeNull();
    expect(extractApiKey(new Headers({ "X-API-Key": "   " }))).toBeNull();
  });

  it("ignores non-Bearer authorization schemes", () => {
    expect(
      extractApiKey(new Headers({ Authorization: "Basic dXNlcjpwYXNz" }))
    ).toBeNull();
  });
});
