import { db } from "@/db";
import { sql } from "drizzle-orm";
import { SOURCE_SYSTEMS } from "@/lib/domain/enums";

// ═══════════════════════════════════════════════════════════════════════════
// Correlation Signals
// Two-level correlation: Level 1 (deterministic) + Level 2 (probabilistic)
// ═══════════════════════════════════════════════════════════════════════════

export const SIGNAL_WEIGHTS = {
  S1_SHARED_FINGERPRINT: 1.0,
  S2_SHARED_DOMAIN: 0.8,
  S3_SHARED_SUBJECT: 0.9,
  S4_SHARED_ACTOR: 0.7,
  S5_SHARED_TARGET_ORG: 0.5,
  S6_TEMPORAL_DECAY_LAMBDA: 0.01, // λ (days⁻¹)
} as const;

export interface SignalResult {
  signalId: string;
  weight: number;
  temporalFactor: number;
  effectiveWeight: number;
  matched: boolean;
  details: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// S1: Shared SecretFingerprint/PhishingURL/Domain canonical key (Level 1)
// ═══════════════════════════════════════════════════════════════════════════
export async function signalSharedFingerprint(
  tenantId: string,
  nodeId1: string,
  nodeId2: string
): Promise<SignalResult> {
  const result = await db.execute(sql`
    SELECT COUNT(*) AS matches
    FROM graph_nodes n1
    JOIN graph_nodes n2
      ON n2.tenant_id = n1.tenant_id
      AND n2.node_type = n1.node_type
      AND n2.canonical_key = n1.canonical_key
      AND n2.node_id != n1.node_id
    WHERE n1.tenant_id = ${tenantId}::uuid
      AND n1.node_id = ${nodeId1}::uuid
      AND n2.node_id = ${nodeId2}::uuid
      AND n1.node_type IN ('SecretFingerprint', 'PhishingURL', 'Domain')
  `);
  const rows = result.rows as Array<{ matches: string }>;
  const matched = parseInt(rows[0]?.matches ?? "0", 10) > 0;

  return {
    signalId: "S1",
    weight: SIGNAL_WEIGHTS.S1_SHARED_FINGERPRINT,
    temporalFactor: 1.0,
    effectiveWeight: matched ? SIGNAL_WEIGHTS.S1_SHARED_FINGERPRINT : 0,
    matched,
    details: matched
      ? "Shared canonical fingerprint/key between nodes"
      : "No shared fingerprint",
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// S2: Shared registrable domain between nodes from different sources
// ═══════════════════════════════════════════════════════════════════════════
export async function signalSharedDomain(
  tenantId: string,
  nodeId1: string,
  nodeId2: string,
  deltaHours: number
): Promise<SignalResult> {
  const result = await db.execute(sql`
    SELECT COUNT(DISTINCT d.node_id) AS shared_domains
    FROM graph_nodes d
    JOIN graph_edges e1
      ON (e1.source_node_id = d.node_id OR e1.target_node_id = d.node_id)
    JOIN graph_edges e2
      ON (e2.source_node_id = d.node_id OR e2.target_node_id = d.node_id)
    WHERE d.tenant_id = ${tenantId}::uuid
      AND d.node_type = 'Domain'
      AND (e1.source_node_id = ${nodeId1}::uuid OR e1.target_node_id = ${nodeId1}::uuid)
      AND (e2.source_node_id = ${nodeId2}::uuid OR e2.target_node_id = ${nodeId2}::uuid)
      AND e1.source_system != ${SOURCE_SYSTEMS.CORRELATION_ENGINE}
      AND e2.source_system != ${SOURCE_SYSTEMS.CORRELATION_ENGINE}
      AND e1.status = 'active'
      AND e2.status = 'active'
  `);
  const rows = result.rows as Array<{ shared_domains: string }>;
  const matched = parseInt(rows[0]?.shared_domains ?? "0", 10) > 0;
  const temporalFactor = computeTemporalDecay(deltaHours);

  return {
    signalId: "S2",
    weight: SIGNAL_WEIGHTS.S2_SHARED_DOMAIN,
    temporalFactor,
    effectiveWeight: matched
      ? SIGNAL_WEIGHTS.S2_SHARED_DOMAIN * temporalFactor
      : 0,
    matched,
    details: matched
      ? `Shared domain node; temporal factor=${temporalFactor.toFixed(3)}`
      : "No shared domain",
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// S3: Shared SubjectIndex (HMAC) between sources
// ═══════════════════════════════════════════════════════════════════════════
export async function signalSharedSubjectIndex(
  tenantId: string,
  nodeId1: string,
  nodeId2: string,
  deltaHours: number
): Promise<SignalResult> {
  const result = await db.execute(sql`
    SELECT COUNT(DISTINCT s.node_id) AS shared_subjects
    FROM graph_nodes s
    JOIN graph_edges e1
      ON (e1.source_node_id = s.node_id OR e1.target_node_id = s.node_id)
    JOIN graph_edges e2
      ON (e2.source_node_id = s.node_id OR e2.target_node_id = s.node_id)
    WHERE s.tenant_id = ${tenantId}::uuid
      AND s.node_type = 'SubjectIndex'
      AND (e1.source_node_id = ${nodeId1}::uuid OR e1.target_node_id = ${nodeId1}::uuid)
      AND (e2.source_node_id = ${nodeId2}::uuid OR e2.target_node_id = ${nodeId2}::uuid)
      AND e1.source_system != ${SOURCE_SYSTEMS.CORRELATION_ENGINE}
      AND e2.source_system != ${SOURCE_SYSTEMS.CORRELATION_ENGINE}
      AND e1.status = 'active'
      AND e2.status = 'active'
  `);
  const rows = result.rows as Array<{ shared_subjects: string }>;
  const matched = parseInt(rows[0]?.shared_subjects ?? "0", 10) > 0;
  const temporalFactor = computeTemporalDecay(deltaHours);

  return {
    signalId: "S3",
    weight: SIGNAL_WEIGHTS.S3_SHARED_SUBJECT,
    temporalFactor,
    effectiveWeight: matched
      ? SIGNAL_WEIGHTS.S3_SHARED_SUBJECT * temporalFactor
      : 0,
    matched,
    details: matched
      ? `Shared SubjectIndex; temporal factor=${temporalFactor.toFixed(3)}`
      : "No shared SubjectIndex",
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// S4: Shared Actor within temporal window
// ═══════════════════════════════════════════════════════════════════════════
export async function signalSharedActor(
  tenantId: string,
  nodeId1: string,
  nodeId2: string,
  deltaHours: number
): Promise<SignalResult> {
  const result = await db.execute(sql`
    SELECT COUNT(DISTINCT a.node_id) AS shared_actors
    FROM graph_nodes a
    JOIN graph_edges e1
      ON (e1.source_node_id = a.node_id OR e1.target_node_id = a.node_id)
    JOIN graph_edges e2
      ON (e2.source_node_id = a.node_id OR e2.target_node_id = a.node_id)
    WHERE a.tenant_id = ${tenantId}::uuid
      AND a.node_type = 'Actor'
      AND (e1.source_node_id = ${nodeId1}::uuid OR e1.target_node_id = ${nodeId1}::uuid)
      AND (e2.source_node_id = ${nodeId2}::uuid OR e2.target_node_id = ${nodeId2}::uuid)
      AND e1.source_system != ${SOURCE_SYSTEMS.CORRELATION_ENGINE}
      AND e2.source_system != ${SOURCE_SYSTEMS.CORRELATION_ENGINE}
      AND e1.status = 'active'
      AND e2.status = 'active'
  `);
  const rows = result.rows as Array<{ shared_actors: string }>;
  const matched = parseInt(rows[0]?.shared_actors ?? "0", 10) > 0;
  const temporalFactor = computeTemporalDecay(deltaHours);

  return {
    signalId: "S4",
    weight: SIGNAL_WEIGHTS.S4_SHARED_ACTOR,
    temporalFactor,
    effectiveWeight: matched
      ? SIGNAL_WEIGHTS.S4_SHARED_ACTOR * temporalFactor
      : 0,
    matched,
    details: matched
      ? `Shared Actor; temporal factor=${temporalFactor.toFixed(3)}`
      : "No shared Actor",
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// S5: Shared target Organization
// ═══════════════════════════════════════════════════════════════════════════
export async function signalSharedTargetOrg(
  tenantId: string,
  nodeId1: string,
  nodeId2: string,
  deltaHours: number
): Promise<SignalResult> {
  const result = await db.execute(sql`
    SELECT COUNT(DISTINCT o.node_id) AS shared_orgs
    FROM graph_nodes o
    JOIN graph_edges e1 ON (e1.target_node_id = o.node_id)
    JOIN graph_edges e2 ON (e2.target_node_id = o.node_id)
    WHERE o.tenant_id = ${tenantId}::uuid
      AND o.node_type = 'Organization'
      AND e1.source_node_id = ${nodeId1}::uuid
      AND e2.source_node_id = ${nodeId2}::uuid
      AND e1.source_system != ${SOURCE_SYSTEMS.CORRELATION_ENGINE}
      AND e2.source_system != ${SOURCE_SYSTEMS.CORRELATION_ENGINE}
      AND e1.status = 'active'
      AND e2.status = 'active'
  `);
  const rows = result.rows as Array<{ shared_orgs: string }>;
  const matched = parseInt(rows[0]?.shared_orgs ?? "0", 10) > 0;
  const temporalFactor = computeTemporalDecay(deltaHours);

  return {
    signalId: "S5",
    weight: SIGNAL_WEIGHTS.S5_SHARED_TARGET_ORG,
    temporalFactor,
    effectiveWeight: matched
      ? SIGNAL_WEIGHTS.S5_SHARED_TARGET_ORG * temporalFactor
      : 0,
    matched,
    details: matched
      ? `Shared target Organization; temporal factor=${temporalFactor.toFixed(3)}`
      : "No shared Organization",
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Temporal decay: e^(-λΔt), λ in days⁻¹, Δt in hours
// ═══════════════════════════════════════════════════════════════════════════
export function computeTemporalDecay(deltaHours: number): number {
  const lambdaDays = SIGNAL_WEIGHTS.S6_TEMPORAL_DECAY_LAMBDA;
  const lambdaHours = lambdaDays / 24;
  return Math.exp(-lambdaHours * Math.abs(deltaHours));
}

export function deltaHoursBetween(date1: Date, date2: Date): number {
  return Math.abs(date1.getTime() - date2.getTime()) / (1000 * 60 * 60);
}
