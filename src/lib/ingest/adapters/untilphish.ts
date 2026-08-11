import { z } from "zod";
import type { GraphEvent, EntityRef, RelationRef } from "@/lib/domain/events";
import {
  canonicalDomain,
  canonicalPhishingURL,
  canonicalActor,
} from "@/lib/domain/canonical";
import {
  NodeType,
  RelationType,
  SOURCE_SYSTEMS,
  verdictToConfidence,
} from "@/lib/domain/enums";

// ═══════════════════════════════════════════════════════════════════════════
// UntilPhish-Go — Zod adapter
// tenant_id injected from API key (documented gap §7.5)
// ═══════════════════════════════════════════════════════════════════════════

const UntilPhishEventSchema = z.object({
  event_id: z.string(),
  event_type: z.string().default("PhishingDetected"),
  correlation_id: z.string().optional().nullable(),
  occurred_at: z.string().datetime().optional().nullable(),
  url: z.string(),
  domain: z.string().optional().nullable(),
  verdict: z.string(), // malicious | suspicious | clean
  source_platform: z.string().default("untilphish"),
  author_id: z.string().optional().nullable(),
  author_handle: z.string().optional().nullable(),
  ip_addresses: z.array(z.string()).optional().default([]),
  categories: z.array(z.string()).optional().default([]),
  attributes: z.record(z.string(), z.unknown()).optional().default({}),
});

/** Adapter: UntilPhish event → GraphEvent (tenantId injected by router) */
export function adaptUntilPhishEvent(
  raw: unknown,
  receivedAt: string,
  tenantId: string
): GraphEvent {
  const parsed = UntilPhishEventSchema.parse(raw);
  const occurredAt = parsed.occurred_at ?? receivedAt;

  const confidence = verdictToConfidence(parsed.verdict);
  const urlKey = canonicalPhishingURL(parsed.url);

  const rawDomain =
    parsed.domain ??
    (() => {
      try {
        return new URL(parsed.url).hostname;
      } catch {
        return parsed.url;
      }
    })();
  const domainKey = canonicalDomain(rawDomain);

  const entities: EntityRef[] = [
    {
      nodeType: NodeType.PhishingURL,
      canonicalKey: urlKey,
      attributes: {
        verdict: parsed.verdict,
        categories: parsed.categories,
        ip_addresses: parsed.ip_addresses,
        source_refs: {
          [SOURCE_SYSTEMS.UNTIL_PHISH]: parsed.url,
        },
        ...parsed.attributes,
      },
      confidence,
    },
    {
      nodeType: NodeType.Domain,
      canonicalKey: domainKey,
      attributes: {
        raw_domain: rawDomain,
        source_refs: {
          [SOURCE_SYSTEMS.UNTIL_PHISH]: rawDomain,
        },
      },
    },
  ];

  const relations: RelationRef[] = [
    {
      sourceType: NodeType.PhishingURL,
      sourceKey: urlKey,
      targetType: NodeType.Domain,
      targetKey: domainKey,
      relationType: RelationType.USES_DOMAIN,
      edgeKind: "observed",
      confidence,
      evidenceIds: [parsed.event_id],
    },
  ];

  if (parsed.author_id) {
    const actorKey = canonicalActor(parsed.source_platform, parsed.author_id);
    entities.push({
      nodeType: NodeType.Actor,
      canonicalKey: actorKey,
      attributes: {
        source_platform: parsed.source_platform,
        author_id: parsed.author_id,
        author_handle: parsed.author_handle,
        source_refs: {
          [SOURCE_SYSTEMS.UNTIL_PHISH]: parsed.author_id,
        },
      },
    });

    relations.push({
      sourceType: NodeType.PhishingURL,
      sourceKey: urlKey,
      targetType: NodeType.Actor,
      targetKey: actorKey,
      relationType: RelationType.AUTHORED_BY,
      edgeKind: "observed",
      confidence,
      evidenceIds: [parsed.event_id],
    });
  }

  const evidence = [
    {
      evidenceId: parsed.event_id,
      sourceSystem: SOURCE_SYSTEMS.UNTIL_PHISH,
      sourceRecordId: parsed.event_id,
      description: `Phishing URL detected: verdict=${parsed.verdict}, domain=${domainKey}`,
      attributes: {
        verdict: parsed.verdict,
        confidence,
        url_key: urlKey,
        domain_key: domainKey,
      },
    },
  ];

  return {
    eventId: parsed.event_id,
    eventType: parsed.event_type,
    eventVersion: 1,
    tenantId,
    correlationId: parsed.correlation_id ?? null,
    sourceSystem: SOURCE_SYSTEMS.UNTIL_PHISH,
    occurredAt,
    observedAt: receivedAt,
    entities,
    relations,
    evidence,
  };
}
