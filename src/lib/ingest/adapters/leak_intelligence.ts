import { z } from "zod";
import type { GraphEvent, EntityRef, RelationRef } from "@/lib/domain/events";
import {
  canonicalSubjectIndex,
  canonicalLeakIncident,
} from "@/lib/domain/canonical";
import { NodeType, RelationType, SOURCE_SYSTEMS } from "@/lib/domain/enums";

// ═══════════════════════════════════════════════════════════════════════════
// Leak Intelligence — Zod adapters
// Two event types: ExposureObserved and ExposureAssessed
// ═══════════════════════════════════════════════════════════════════════════

const SubjectIndexEntrySchema = z.object({
  digest: z.string(),
  type: z.string().optional().nullable(),
});

const ExposureObservedSchema = z.object({
  event_id: z.string(),
  event_type: z.string().default("ExposureObserved"),
  tenant_id: z.string(),
  correlation_id: z.string().optional().nullable(),
  occurred_at: z.string().datetime().optional().nullable(),
  source_id: z.string(),
  source_record_id: z.string(),
  incident_name: z.string().optional().nullable(),
  subject_indexes: z.array(SubjectIndexEntrySchema).default([]),
  exposed_types: z.array(z.string()).optional().default([]),
  attributes: z.record(z.string(), z.unknown()).optional().default({}),
});

const ExposureAssessedSchema = z.object({
  event_id: z.string(),
  event_type: z.string().default("ExposureAssessed"),
  tenant_id: z.string(),
  correlation_id: z.string().optional().nullable(),
  occurred_at: z.string().datetime().optional().nullable(),
  source_id: z.string(),
  source_record_id: z.string(),
  risk_score: z.number().min(0).max(1),
  status: z.string(),
  exposed_types: z.array(z.string()).optional().default([]),
  attributes: z.record(z.string(), z.unknown()).optional().default({}),
});

/** Adapter: ExposureObserved → GraphEvent */
export function adaptExposureObserved(
  raw: unknown,
  receivedAt: string
): GraphEvent {
  const parsed = ExposureObservedSchema.parse(raw);
  const occurredAt = parsed.occurred_at ?? receivedAt;

  const incidentKey = canonicalLeakIncident(
    parsed.source_id,
    parsed.source_record_id
  );

  const entities: EntityRef[] = [
    {
      nodeType: NodeType.LeakIncident,
      canonicalKey: incidentKey,
      attributes: {
        incident_name: parsed.incident_name,
        source_id: parsed.source_id,
        source_record_id: parsed.source_record_id,
        exposed_types: parsed.exposed_types,
        source_refs: {
          [SOURCE_SYSTEMS.LEAK_INTELLIGENCE]: parsed.source_record_id,
        },
        ...parsed.attributes,
      },
    },
  ];

  const relations: RelationRef[] = [];

  for (const subjectEntry of parsed.subject_indexes) {
    const subjectKey = canonicalSubjectIndex(subjectEntry.digest);

    entities.push({
      nodeType: NodeType.SubjectIndex,
      canonicalKey: subjectKey,
      attributes: {
        subject_type: subjectEntry.type ?? "unknown",
        source_refs: {
          [SOURCE_SYSTEMS.LEAK_INTELLIGENCE]: subjectEntry.digest,
        },
      },
    });

    relations.push({
      sourceType: NodeType.SubjectIndex,
      sourceKey: subjectKey,
      targetType: NodeType.LeakIncident,
      targetKey: incidentKey,
      relationType: RelationType.OBSERVED_IN,
      edgeKind: "observed",
      confidence: 1.0,
      evidenceIds: [parsed.event_id],
    });
  }

  const evidence = [
    {
      evidenceId: parsed.event_id,
      sourceSystem: SOURCE_SYSTEMS.LEAK_INTELLIGENCE,
      sourceRecordId: parsed.source_record_id,
      description: `Leak exposure observed: ${parsed.incident_name ?? incidentKey}`,
      attributes: {
        exposed_types: parsed.exposed_types,
        subject_count: parsed.subject_indexes.length,
      },
    },
  ];

  return {
    eventId: parsed.event_id,
    eventType: parsed.event_type,
    eventVersion: 1,
    tenantId: parsed.tenant_id,
    correlationId: parsed.correlation_id ?? null,
    sourceSystem: SOURCE_SYSTEMS.LEAK_INTELLIGENCE,
    occurredAt,
    observedAt: receivedAt,
    entities,
    relations,
    evidence,
  };
}

/** Adapter: ExposureAssessed → GraphEvent (enrichment only) */
export function adaptExposureAssessed(
  raw: unknown,
  receivedAt: string
): GraphEvent {
  const parsed = ExposureAssessedSchema.parse(raw);
  const occurredAt = parsed.occurred_at ?? receivedAt;

  const incidentKey = canonicalLeakIncident(
    parsed.source_id,
    parsed.source_record_id
  );

  const entities: EntityRef[] = [
    {
      nodeType: NodeType.LeakIncident,
      canonicalKey: incidentKey,
      attributes: {
        risk_score: parsed.risk_score,
        assessment_status: parsed.status,
        exposed_types: parsed.exposed_types,
        assessed_at: occurredAt,
        source_refs: {
          [SOURCE_SYSTEMS.LEAK_INTELLIGENCE]: parsed.source_record_id,
        },
        ...parsed.attributes,
      },
    },
  ];

  const evidence = [
    {
      evidenceId: parsed.event_id,
      sourceSystem: SOURCE_SYSTEMS.LEAK_INTELLIGENCE,
      sourceRecordId: parsed.source_record_id,
      description: `Leak exposure assessed: risk_score=${parsed.risk_score}, status=${parsed.status}`,
      attributes: {
        risk_score: parsed.risk_score,
        status: parsed.status,
      },
    },
  ];

  return {
    eventId: parsed.event_id,
    eventType: parsed.event_type,
    eventVersion: 1,
    tenantId: parsed.tenant_id,
    correlationId: parsed.correlation_id ?? null,
    sourceSystem: SOURCE_SYSTEMS.LEAK_INTELLIGENCE,
    occurredAt,
    observedAt: receivedAt,
    entities,
    relations: [], // ExposureAssessed does NOT create new edges
    evidence,
  };
}
