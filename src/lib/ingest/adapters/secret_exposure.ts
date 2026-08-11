import { z } from "zod";
import type { GraphEvent } from "@/lib/domain/events";
import {
  canonicalRepository,
  canonicalCommit,
  canonicalSecretFingerprint,
} from "@/lib/domain/canonical";
import {
  NodeType,
  RelationType,
  SOURCE_SYSTEMS,
  KNOWN_RELATION_TYPES,
} from "@/lib/domain/enums";

// ═══════════════════════════════════════════════════════════════════════════
// Secret Exposure Monitor — Zod adapter
// ═══════════════════════════════════════════════════════════════════════════

const GraphRelationSchema = z.object({
  source_id: z.string(),
  source_type: z.string(),
  target_id: z.string(),
  target_type: z.string(),
  relation_type: z.string(),
  confidence: z.number().min(0).max(1).optional().default(0.8),
});

const SecretExposureDetectedSchema = z.object({
  event_id: z.string(),
  event_type: z.string().default("SecretExposureDetected"),
  tenant_id: z.string(),
  correlation_id: z.string().optional().nullable(),
  occurred_at: z.string().datetime().optional().nullable(),
  repository_id: z.string(),
  repository_provider: z.string().default("github"),
  repository_owner: z.string().optional().nullable(),
  repository_name: z.string().optional().nullable(),
  commit_sha: z.string(),
  secret_type: z.string().optional().nullable(),
  fingerprint: z.string(),
  key_version: z.string().default("v1"),
  finding_confidence: z.number().min(0).max(1).default(0.8),
  relations: z.array(GraphRelationSchema).optional().default([]),
  graph_hints: z.array(z.string()).optional().default([]),
  attributes: z.record(z.string(), z.unknown()).optional().default({}),
});

export type SecretExposureDetectedInput = z.infer<
  typeof SecretExposureDetectedSchema
>;

/** Adapter: SecretExposureDetected → GraphEvent */
export function adaptSecretExposureDetected(
  raw: unknown,
  receivedAt: string
): GraphEvent {
  const parsed = SecretExposureDetectedSchema.parse(raw);

  // §7.1: no occurred_at → fallback to receivedAt
  const occurredAt = parsed.occurred_at ?? receivedAt;

  const provider = parsed.repository_provider;
  const owner = parsed.repository_owner ?? parsed.repository_id;
  const repoName = parsed.repository_name ?? parsed.repository_id;

  const repoKey = canonicalRepository(provider, owner, repoName);
  const commitKey = canonicalCommit(
    provider,
    owner,
    repoName,
    parsed.commit_sha
  );
  const fingerprintKey = canonicalSecretFingerprint(
    parsed.key_version,
    parsed.fingerprint
  );

  // Validate graph_hints — only known types
  const validHints: string[] = [];
  for (const hint of parsed.graph_hints) {
    if (KNOWN_RELATION_TYPES.has(hint)) {
      validHints.push(hint);
    } else {
      console.warn(
        `[secret-exposure-adapter] Unknown graph_hint '${hint}' — ignoring`
      );
    }
  }

  const entities = [
    {
      nodeType: NodeType.Repository,
      canonicalKey: repoKey,
      attributes: {
        provider,
        owner,
        name: repoName,
        source_refs: {
          [SOURCE_SYSTEMS.SECRET_EXPOSURE_MONITOR]: parsed.repository_id,
        },
        ...parsed.attributes,
      },
    },
    {
      nodeType: NodeType.Commit,
      canonicalKey: commitKey,
      attributes: {
        sha: parsed.commit_sha,
        repository: repoKey,
        source_refs: {
          [SOURCE_SYSTEMS.SECRET_EXPOSURE_MONITOR]: `${parsed.repository_id}:${parsed.commit_sha}`,
        },
      },
    },
    {
      nodeType: NodeType.SecretFingerprint,
      canonicalKey: fingerprintKey,
      attributes: {
        secret_type: parsed.secret_type,
        key_version: parsed.key_version,
        source_refs: {
          [SOURCE_SYSTEMS.SECRET_EXPOSURE_MONITOR]: parsed.fingerprint,
        },
      },
      confidence: parsed.finding_confidence,
    },
  ];

  const relations = [
    {
      sourceType: NodeType.Repository,
      sourceKey: repoKey,
      targetType: NodeType.Commit,
      targetKey: commitKey,
      relationType: RelationType.CONTAINS_COMMIT,
      edgeKind: "observed" as const,
      confidence: 1.0,
      evidenceIds: [parsed.event_id],
    },
    {
      sourceType: NodeType.Commit,
      sourceKey: commitKey,
      targetType: NodeType.SecretFingerprint,
      targetKey: fingerprintKey,
      relationType: RelationType.EXPOSED,
      edgeKind: "observed" as const,
      confidence: parsed.finding_confidence,
      evidenceIds: [parsed.event_id],
    },
  ];

  const evidence = [
    {
      evidenceId: parsed.event_id,
      sourceSystem: SOURCE_SYSTEMS.SECRET_EXPOSURE_MONITOR,
      sourceRecordId: parsed.event_id,
      description: `Secret exposure detected in ${repoKey} at commit ${parsed.commit_sha}`,
      attributes: {
        secret_type: parsed.secret_type,
        finding_confidence: parsed.finding_confidence,
        valid_graph_hints: validHints,
      },
    },
  ];

  return {
    eventId: parsed.event_id,
    eventType: parsed.event_type,
    eventVersion: 1,
    tenantId: parsed.tenant_id,
    correlationId: parsed.correlation_id ?? null,
    sourceSystem: SOURCE_SYSTEMS.SECRET_EXPOSURE_MONITOR,
    occurredAt,
    observedAt: receivedAt,
    entities,
    relations,
    evidence,
  };
}
