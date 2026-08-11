import { describe, it, expect } from "vitest";
import {
  normalizeRegistrableDomain,
  canonicalRepository,
  canonicalCommit,
  canonicalSecretFingerprint,
  canonicalSubjectIndex,
  canonicalPhishingURL,
  canonicalDomain,
  canonicalLeakIncident,
  canonicalActor,
} from "@/lib/domain/canonical";

describe("canonical keys", () => {
  describe("normalizeRegistrableDomain", () => {
    it("lowercases domains", () => {
      expect(normalizeRegistrableDomain("Example.COM")).toBe("example.com");
    });

    it("strips www prefix", () => {
      expect(normalizeRegistrableDomain("www.example.com")).toBe("example.com");
    });

    it("strips trailing dot", () => {
      expect(normalizeRegistrableDomain("example.com.")).toBe("example.com");
    });

    it("strips protocol", () => {
      expect(normalizeRegistrableDomain("https://example.com/path")).toBe(
        "example.com"
      );
    });
  });

  describe("canonicalRepository", () => {
    it("creates key with provider:owner/repo", () => {
      const key = canonicalRepository("github", "acme-corp", "web-app");
      expect(key).toBe("github:acme-corp/web-app");
    });

    it("lowercases provider", () => {
      const key = canonicalRepository("GitHub", "Owner", "Repo");
      expect(key).toBe("github:Owner/Repo");
    });
  });

  describe("canonicalCommit", () => {
    it("creates key with provider:owner/repo:sha", () => {
      const key = canonicalCommit(
        "github",
        "acme-corp",
        "web-app",
        "abc123def456"
      );
      expect(key).toBe("github:acme-corp/web-app:abc123def456");
    });
  });

  describe("canonicalSecretFingerprint", () => {
    it("uses hmac:secret prefix", () => {
      const key = canonicalSecretFingerprint("v1", "fp-001");
      expect(key).toBe("hmac:secret:v1:fp-001");
    });
  });

  describe("canonicalSubjectIndex", () => {
    it("uses hmac:v3 prefix (different from SecretFingerprint)", () => {
      const key = canonicalSubjectIndex("digest-abc");
      expect(key).toBe("hmac:v3:digest-abc");
    });

    it("never overlaps with SecretFingerprint keys", () => {
      const secretKey = canonicalSecretFingerprint("v3", "same-digest");
      const subjectKey = canonicalSubjectIndex("same-digest");
      expect(secretKey).not.toBe(subjectKey);
    });
  });

  describe("canonicalPhishingURL", () => {
    it("produces sha256: digest", () => {
      const key = canonicalPhishingURL("https://evil-phish.com/verify");
      expect(key).toMatch(/^sha256:[a-f0-9]{64}$/);
    });

    it("is deterministic", () => {
      const a = canonicalPhishingURL("https://evil-phish.com/verify");
      const b = canonicalPhishingURL("https://evil-phish.com/verify");
      expect(a).toBe(b);
    });
  });

  describe("canonicalDomain", () => {
    it("normalizes via registrable domain", () => {
      expect(canonicalDomain("www.example.com")).toBe("example.com");
    });
  });

  describe("canonicalLeakIncident", () => {
    it("uses sourceSystem:recordId pattern", () => {
      const key = canonicalLeakIncident("leak-intelligence", "rec-001");
      expect(key).toBe("leak-intelligence:rec-001");
    });
  });

  describe("canonicalActor", () => {
    it("lowercases platform", () => {
      const key = canonicalActor("GitHub", "user-123");
      expect(key).toBe("github:user-123");
    });
  });
});
