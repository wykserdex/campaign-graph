// ═══════════════════════════════════════════════════════════════════════════
// Canonical NodeType enum
// ═══════════════════════════════════════════════════════════════════════════
export const NodeType = {
  Repository: "Repository",
  Commit: "Commit",
  SecretFingerprint: "SecretFingerprint",
  Provider: "Provider",
  Domain: "Domain",
  PhishingURL: "PhishingURL",
  Actor: "Actor",
  Organization: "Organization",
  LeakIncident: "LeakIncident",
  SubjectIndex: "SubjectIndex",
  Campaign: "Campaign",
} as const;
export type NodeType = (typeof NodeType)[keyof typeof NodeType];

// ═══════════════════════════════════════════════════════════════════════════
// Canonical RelationType enum
// ═══════════════════════════════════════════════════════════════════════════
export const RelationType = {
  // Secret Exposure Monitor
  CONTAINS_COMMIT: "CONTAINS_COMMIT",
  EXPOSED: "EXPOSED",
  HOSTED_ON: "HOSTED_ON",
  // Leak Intelligence
  OBSERVED_IN: "OBSERVED_IN",
  TARGETS: "TARGETS",
  // UntilPhish
  RESOLVES_TO: "RESOLVES_TO",
  HOSTS_PHISHING: "HOSTS_PHISHING",
  AUTHORED_BY: "AUTHORED_BY",
  USES_DOMAIN: "USES_DOMAIN",
  // Cross-source correlations (written only by correlation engine)
  RELATED_TO: "RELATED_TO",
  PART_OF_CAMPAIGN: "PART_OF_CAMPAIGN",
  MEMBER_OF_CAMPAIGN: "MEMBER_OF_CAMPAIGN",
  SHARES_INFRASTRUCTURE: "SHARES_INFRASTRUCTURE",
  SHARES_SECRET: "SHARES_SECRET",
  SHARES_SUBJECT: "SHARES_SUBJECT",
} as const;
export type RelationType = (typeof RelationType)[keyof typeof RelationType];

// ═══════════════════════════════════════════════════════════════════════════
// EdgeKind enum
// ═══════════════════════════════════════════════════════════════════════════
export const EdgeKind = {
  observed: "observed",
  asserted: "asserted",
  inferred: "inferred",
} as const;
export type EdgeKind = (typeof EdgeKind)[keyof typeof EdgeKind];

// ═══════════════════════════════════════════════════════════════════════════
// EdgeStatus enum
// ═══════════════════════════════════════════════════════════════════════════
export const EdgeStatus = {
  active: "active",
  superseded: "superseded",
  retracted: "retracted",
} as const;
export type EdgeStatus = (typeof EdgeStatus)[keyof typeof EdgeStatus];

// ═══════════════════════════════════════════════════════════════════════════
// HypothesisStatus enum
// ═══════════════════════════════════════════════════════════════════════════
export const HypothesisStatus = {
  proposed: "proposed",
  confirmed: "confirmed",
  rejected: "rejected",
  merged: "merged",
} as const;
export type HypothesisStatus =
  (typeof HypothesisStatus)[keyof typeof HypothesisStatus];

// ═══════════════════════════════════════════════════════════════════════════
// ProcessingStatus enum
// ═══════════════════════════════════════════════════════════════════════════
export const ProcessingStatus = {
  received: "received",
  processed: "processed",
  failed: "failed",
} as const;
export type ProcessingStatus =
  (typeof ProcessingStatus)[keyof typeof ProcessingStatus];

// ═══════════════════════════════════════════════════════════════════════════
// Source system constants
// ═══════════════════════════════════════════════════════════════════════════
export const SOURCE_SYSTEMS = {
  SECRET_EXPOSURE_MONITOR: "secret-exposure-monitor",
  LEAK_INTELLIGENCE: "leak-intelligence",
  UNTIL_PHISH: "until-phish",
  CORRELATION_ENGINE: "__correlation_engine__",
} as const;
export type SourceSystem =
  (typeof SOURCE_SYSTEMS)[keyof typeof SOURCE_SYSTEMS];

// ═══════════════════════════════════════════════════════════════════════════
// Verdict → Confidence mapping (UntilPhish-Go fixed table)
// ═══════════════════════════════════════════════════════════════════════════
export const VERDICT_CONFIDENCE: Record<string, number> = {
  malicious: 0.9,
  suspicious: 0.5,
  clean: 0.05,
} as const;

export function verdictToConfidence(verdict: string): number {
  const lower = verdict.toLowerCase();
  if (lower in VERDICT_CONFIDENCE) {
    return VERDICT_CONFIDENCE[lower];
  }
  return 0.1; // conservative unknown
}

// ═══════════════════════════════════════════════════════════════════════════
// Relation types that ONLY the correlation engine may create (§5.3)
// ═══════════════════════════════════════════════════════════════════════════
export const CORRELATION_ENGINE_ONLY_RELATIONS: Set<string> = new Set([
  RelationType.RELATED_TO,
  RelationType.PART_OF_CAMPAIGN,
  RelationType.MEMBER_OF_CAMPAIGN,
  RelationType.SHARES_INFRASTRUCTURE,
  RelationType.SHARES_SECRET,
  RelationType.SHARES_SUBJECT,
]);

// ═══════════════════════════════════════════════════════════════════════════
// Known relation types (for validating graph_hints from source events)
// ═══════════════════════════════════════════════════════════════════════════
export const KNOWN_RELATION_TYPES: Set<string> = new Set(
  Object.values(RelationType)
);
