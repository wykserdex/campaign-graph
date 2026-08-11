import { describe, it, expect } from "vitest";
import { adaptSecretExposureDetected } from "@/lib/ingest/adapters/secret_exposure";
import {
  adaptExposureObserved,
  adaptExposureAssessed,
} from "@/lib/ingest/adapters/leak_intelligence";
import { adaptUntilPhishEvent } from "@/lib/ingest/adapters/untilphish";
import { SOURCE_SYSTEMS, NodeType, RelationType } from "@/lib/domain/enums";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";

describe("Secret Exposure adapter", () => {
  it("produces correct entities", () => {
    const raw = {
      event_id: "evt-se-001",
      tenant_id: TENANT_ID,
      repository_id: "repo-acme-web",
      repository_provider: "github",
      repository_owner: "acme-corp",
      repository_name: "web-app",
      commit_sha: "abc123def456",
      secret_type: "aws_access_key",
      fingerprint: "fp-001",
      key_version: "v1",
      finding_confidence: 0.95,
    };

    const event = adaptSecretExposureDetected(raw, "2025-01-01T00:00:00Z");

    expect(event.eventId).toBe("evt-se-001");
    expect(event.sourceSystem).toBe(SOURCE_SYSTEMS.SECRET_EXPOSURE_MONITOR);
    expect(event.tenantId).toBe(TENANT_ID);
    expect(event.entities).toHaveLength(3);
    expect(event.relations).toHaveLength(2);

    const nodeTypes = event.entities.map((e) => e.nodeType);
    expect(nodeTypes).toContain(NodeType.Repository);
    expect(nodeTypes).toContain(NodeType.Commit);
    expect(nodeTypes).toContain(NodeType.SecretFingerprint);

    const relTypes = event.relations.map((r) => r.relationType);
    expect(relTypes).toContain(RelationType.CONTAINS_COMMIT);
    expect(relTypes).toContain(RelationType.EXPOSED);
  });

  it("falls back occurred_at to receivedAt (§7.1)", () => {
    const raw = {
      event_id: "evt-se-002",
      tenant_id: TENANT_ID,
      repository_id: "repo-2",
      commit_sha: "sha-2",
      fingerprint: "fp-2",
      key_version: "v1",
    };

    const event = adaptSecretExposureDetected(raw, "2025-06-01T12:00:00Z");
    expect(event.occurredAt).toBe("2025-06-01T12:00:00Z");
  });

  it("rejects invalid input via Zod", () => {
    expect(() =>
      adaptSecretExposureDetected(
        { event_id: "bad", tenant_id: 123 },
        "2025-01-01T00:00:00Z"
      )
    ).toThrow();
  });
});

describe("Leak Intelligence adapter", () => {
  it("adapts ExposureObserved", () => {
    const raw = {
      event_id: "evt-li-001",
      tenant_id: TENANT_ID,
      source_id: "leak-intelligence",
      source_record_id: "rec-001",
      incident_name: "Test leak",
      subject_indexes: [{ digest: "digest-abc", type: "email" }],
    };

    const event = adaptExposureObserved(raw, "2025-01-01T00:00:00Z");

    expect(event.eventId).toBe("evt-li-001");
    expect(event.sourceSystem).toBe(SOURCE_SYSTEMS.LEAK_INTELLIGENCE);

    const nodeTypes = event.entities.map((e) => e.nodeType);
    expect(nodeTypes).toContain(NodeType.LeakIncident);
    expect(nodeTypes).toContain(NodeType.SubjectIndex);

    expect(event.relations).toHaveLength(1);
    expect(event.relations[0].relationType).toBe(RelationType.OBSERVED_IN);
  });

  it("adapts ExposureAssessed (enrichment only, no edges)", () => {
    const raw = {
      event_id: "evt-li-002",
      tenant_id: TENANT_ID,
      source_id: "leak-intelligence",
      source_record_id: "rec-002",
      risk_score: 0.8,
      status: "verified",
    };

    const event = adaptExposureAssessed(raw, "2025-01-01T00:00:00Z");

    expect(event.relations).toHaveLength(0);
    expect(event.entities).toHaveLength(1);
    expect(event.entities[0].nodeType).toBe(NodeType.LeakIncident);
  });
});

describe("UntilPhish adapter", () => {
  it("adapts PhishingDetected event", () => {
    const raw = {
      event_id: "evt-up-001",
      url: "https://evil-phish.com/verify",
      domain: "evil-phish.com",
      verdict: "malicious",
      source_platform: "untilphish",
      author_id: "actor-001",
      author_handle: "phisher_king",
    };

    const event = adaptUntilPhishEvent(raw, "2025-01-01T00:00:00Z", TENANT_ID);

    expect(event.eventId).toBe("evt-up-001");
    expect(event.sourceSystem).toBe(SOURCE_SYSTEMS.UNTIL_PHISH);
    expect(event.tenantId).toBe(TENANT_ID);

    const nodeTypes = event.entities.map((e) => e.nodeType);
    expect(nodeTypes).toContain(NodeType.PhishingURL);
    expect(nodeTypes).toContain(NodeType.Domain);
    expect(nodeTypes).toContain(NodeType.Actor);

    const relTypes = event.relations.map((r) => r.relationType);
    expect(relTypes).toContain(RelationType.USES_DOMAIN);
    expect(relTypes).toContain(RelationType.AUTHORED_BY);
  });

  it("maps verdict to confidence", () => {
    const raw = {
      event_id: "evt-up-002",
      url: "https://safe.com",
      verdict: "clean",
    };

    const event = adaptUntilPhishEvent(raw, "2025-01-01T00:00:00Z", TENANT_ID);
    const phishingEntity = event.entities.find(
      (e) => e.nodeType === NodeType.PhishingURL
    );
    expect(phishingEntity?.confidence).toBe(0.05);
  });
});
