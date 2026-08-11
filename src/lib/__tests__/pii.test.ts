import { describe, it, expect } from "vitest";
import { redactDeep, redactJsonString } from "@/lib/domain/pii";

describe("PII redaction", () => {
  describe("redactDeep", () => {
    it("redacts email addresses", () => {
      const result = redactDeep("Contact: user@example.com");
      expect(result).toBe("Contact: [REDACTED_EMAIL]");
    });

    it("redacts phone numbers", () => {
      const result = redactDeep("Call 555-123-4567");
      expect(result).toBe("Call [REDACTED_PHONE]");
    });

    it("redacts credit card numbers", () => {
      const result = redactDeep("Card: 4111-1111-1111-1111");
      expect(result).toBe("Card: [REDACTED_CC]");
    });

    it("redacts SSNs", () => {
      const result = redactDeep("SSN: 123-45-6789");
      expect(result).toBe("SSN: [REDACTED_SSN]");
    });

    it("fully redacts sensitive field names", () => {
      const result = redactDeep("my-secret-value", "password");
      expect(result).toBe("[REDACTED]");
    });

    it("recursively redacts nested objects", () => {
      const input = {
        user: { email: "alice@example.com", phone: "555-111-2222" },
        metadata: { note: "safe text" },
      };
      const result = redactDeep(input) as Record<string, unknown>;
      const user = result.user as Record<string, unknown>;
      expect(user.email).toBe("[REDACTED]");
      expect(user.phone).toBe("[REDACTED]");
      expect((result.metadata as Record<string, unknown>).note).toBe(
        "safe text"
      );
    });

    it("handles arrays", () => {
      const result = redactDeep([
        "user1@example.com",
        "user2@example.com",
      ]) as string[];
      expect(result[0]).toBe("[REDACTED_EMAIL]");
      expect(result[1]).toBe("[REDACTED_EMAIL]");
    });

    it("returns null/undefined unchanged", () => {
      expect(redactDeep(null)).toBeNull();
      expect(redactDeep(undefined)).toBeUndefined();
    });
  });

  describe("redactJsonString", () => {
    it("redacts PII in JSON strings", () => {
      const json =
        '{"email":"test@example.com","note":"hello"}';
      const result = redactJsonString(json);
      expect(result).toContain("[REDACTED_EMAIL]");
      expect(result).not.toContain("test@example.com");
    });
  });
});
