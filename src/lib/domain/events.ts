import { z } from "zod";

// ═══════════════════════════════════════════════════════════════════════════
// Core domain event types for Campaign Graph
// ═══════════════════════════════════════════════════════════════════════════

export const EntityRefSchema = z.object({
  nodeType: z.string(),
  canonicalKey: z.string(),
  attributes: z.record(z.string(), z.unknown()).default({}),
  confidence: z.number().min(0).max(1).optional(),
});
export type EntityRef = z.infer<typeof EntityRefSchema>;

export const RelationRefSchema = z.object({
  sourceType: z.string(),
  sourceKey: z.string(),
  targetType: z.string(),
  targetKey: z.string(),
  relationType: z.string(),
  edgeKind: z.enum(["observed", "asserted", "inferred"]).default("observed"),
  confidence: z.number().min(0).max(1),
  evidenceIds: z.array(z.string()).default([]),
  expiresAt: z.string().datetime().optional().nullable(),
  algorithm: z.string().optional().nullable(),
  algorithmVersion: z.string().optional().nullable(),
});
export type RelationRef = z.infer<typeof RelationRefSchema>;

export const EvidenceRefSchema = z.object({
  evidenceId: z.string(),
  sourceSystem: z.string(),
  sourceRecordId: z.string(),
  description: z.string().optional(),
  attributes: z.record(z.string(), z.unknown()).default({}),
});
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

export const GraphEventSchema = z.object({
  eventId: z.string(),
  eventType: z.string(),
  eventVersion: z.number().int().positive(),
  tenantId: z.string(),
  correlationId: z.string().optional().nullable(),
  sourceSystem: z.string(),
  occurredAt: z.string().datetime(),
  observedAt: z.string().datetime(),
  entities: z.array(EntityRefSchema),
  relations: z.array(RelationRefSchema),
  evidence: z.array(EvidenceRefSchema).default([]),
});
export type GraphEvent = z.infer<typeof GraphEventSchema>;

// ═══════════════════════════════════════════════════════════════════════════
// Ingest result
// ═══════════════════════════════════════════════════════════════════════════
export interface IngestResult {
  eventId: string;
  status: "processed" | "duplicate" | "failed";
  nodesUpserted: number;
  edgesUpserted: number;
  error?: string;
}
