import {
  pgTable,
  uuid,
  text,
  jsonb,
  real,
  timestamp,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ═══════════════════════════════════════════════════════════════════════════
// Multi-tenancy
// ═══════════════════════════════════════════════════════════════════════════

export const tenants = pgTable(
  "tenants",
  {
    tenantId: uuid("tenant_id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    isActive: boolean("is_active").notNull().default(true),
    settings: jsonb("settings").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  }
);

export const ingestionApiKeys = pgTable(
  "ingestion_api_keys",
  {
    apiKeyId: uuid("api_key_id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.tenantId, { onDelete: "cascade" }),
    keyHash: text("key_hash").notNull().unique(),
    keyPrefix: text("key_prefix").notNull(),
    sourceSystem: text("source_system").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_api_keys_tenant").on(t.tenantId),
    index("idx_api_keys_source").on(t.sourceSystem),
  ]
);

// ═══════════════════════════════════════════════════════════════════════════
// Graph Nodes — with GIN index for JSONB attributes
// ═══════════════════════════════════════════════════════════════════════════

export const graphNodes = pgTable(
  "graph_nodes",
  {
    nodeId: uuid("node_id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    nodeType: text("node_type").notNull(),
    canonicalKey: text("canonical_key").notNull(),
    attributes: jsonb("attributes").notNull().default({}),
    confidence: real("confidence"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_graph_nodes_tenant_type_key").on(
      t.tenantId,
      t.nodeType,
      t.canonicalKey
    ),
    index("idx_graph_nodes_tenant_type").on(t.tenantId, t.nodeType),
    index("idx_graph_nodes_gin_attrs").using("gin", t.attributes),
  ]
);

// ═══════════════════════════════════════════════════════════════════════════
// Graph Edges — with §5.3 protection
// ═══════════════════════════════════════════════════════════════════════════

export const graphEdges = pgTable(
  "graph_edges",
  {
    edgeId: uuid("edge_id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    sourceNodeId: uuid("source_node_id")
      .notNull()
      .references(() => graphNodes.nodeId, { onDelete: "cascade" }),
    targetNodeId: uuid("target_node_id")
      .notNull()
      .references(() => graphNodes.nodeId, { onDelete: "cascade" }),
    relationType: text("relation_type").notNull(),
    edgeKind: text("edge_kind").notNull(), // observed | asserted | inferred
    confidence: real("confidence").notNull(),
    evidenceRefs: uuid("evidence_refs").array().notNull().default([]),
    sourceSystem: text("source_system").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    status: text("status").notNull().default("active"),
    algorithm: text("algorithm"),
    algorithmVersion: text("algorithm_version"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_graph_edges_tenant_src_tgt_rel_sys").on(
      t.tenantId,
      t.sourceNodeId,
      t.targetNodeId,
      t.relationType,
      t.sourceSystem
    ),
    index("idx_graph_edges_tenant_src").on(t.tenantId, t.sourceNodeId),
    index("idx_graph_edges_tenant_tgt").on(t.tenantId, t.targetNodeId),
    index("idx_graph_edges_tenant_rel_last").on(
      t.tenantId,
      t.relationType,
      t.lastSeenAt
    ),
  ]
);

// ═══════════════════════════════════════════════════════════════════════════
// Raw Events — idempotency layer
// ═══════════════════════════════════════════════════════════════════════════

export const rawEvents = pgTable(
  "raw_events",
  {
    eventId: uuid("event_id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    eventType: text("event_type").notNull(),
    sourceSystem: text("source_system").notNull(),
    correlationId: uuid("correlation_id"),
    payload: jsonb("payload").notNull(),
    processingStatus: text("processing_status").notNull(),
    processingError: text("processing_error"),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_raw_events_source_event").on(t.sourceSystem, t.eventId),
    index("idx_raw_events_tenant_status").on(t.tenantId, t.processingStatus),
    index("idx_raw_events_tenant_received").on(t.tenantId, t.receivedAt),
  ]
);

// ═══════════════════════════════════════════════════════════════════════════
// Evidence Records
// ═══════════════════════════════════════════════════════════════════════════

export const evidenceRecords = pgTable(
  "evidence_records",
  {
    evidenceId: uuid("evidence_id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    sourceSystem: text("source_system").notNull(),
    sourceRecordId: text("source_record_id").notNull(),
    eventId: uuid("event_id"),
    description: text("description"),
    edgeIds: uuid("edge_ids").array().notNull().default([]),
    attributes: jsonb("attributes").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_evidence_source_record").on(
      t.sourceSystem,
      t.sourceRecordId
    ),
    index("idx_evidence_tenant").on(t.tenantId),
  ]
);

// ═══════════════════════════════════════════════════════════════════════════
// Correlation Hypotheses — with score_breakdown
// ═══════════════════════════════════════════════════════════════════════════

export const correlationHypotheses = pgTable(
  "correlation_hypotheses",
  {
    hypothesisId: uuid("hypothesis_id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    campaignNodeId: uuid("campaign_node_id").references(
      () => graphNodes.nodeId
    ),
    status: text("status").notNull().default("proposed"),
    score: real("score").notNull(),
    contributingEdges: uuid("contributing_edges").array().notNull().default([]),
    scoreBreakdown: jsonb("score_breakdown").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_hypotheses_tenant_status").on(t.tenantId, t.status),
    index("idx_hypotheses_campaign").on(t.campaignNodeId),
  ]
);

// ═══════════════════════════════════════════════════════════════════════════
// Organizations — alias registry
// ═══════════════════════════════════════════════════════════════════════════

export const organizations = pgTable(
  "organizations",
  {
    orgId: uuid("org_id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    canonicalName: text("canonical_name").notNull(),
    aliases: text("aliases").array().notNull().default([]),
    domains: text("domains").array().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_orgs_tenant").on(t.tenantId),
    uniqueIndex("uq_orgs_tenant_name").on(t.tenantId, t.canonicalName),
  ]
);

// ═══════════════════════════════════════════════════════════════════════════
// Audit Trail
// ═══════════════════════════════════════════════════════════════════════════

export const auditTrail = pgTable(
  "audit_trail",
  {
    auditId: uuid("audit_id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    actor: text("actor").notNull().default("system"),
    changes: jsonb("changes").notNull().default({}),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_audit_tenant").on(t.tenantId),
    index("idx_audit_entity").on(t.entityType, t.entityId),
    index("idx_audit_created").on(t.createdAt),
  ]
);

// Type exports
export type Tenant = typeof tenants.$inferSelect;
export type TenantInsert = typeof tenants.$inferInsert;
export type IngestionApiKey = typeof ingestionApiKeys.$inferSelect;
export type IngestionApiKeyInsert = typeof ingestionApiKeys.$inferInsert;
export type GraphNode = typeof graphNodes.$inferSelect;
export type GraphNodeInsert = typeof graphNodes.$inferInsert;
export type GraphEdge = typeof graphEdges.$inferSelect;
export type GraphEdgeInsert = typeof graphEdges.$inferInsert;
export type RawEvent = typeof rawEvents.$inferSelect;
export type RawEventInsert = typeof rawEvents.$inferInsert;
export type EvidenceRecord = typeof evidenceRecords.$inferSelect;
export type EvidenceRecordInsert = typeof evidenceRecords.$inferInsert;
export type CorrelationHypothesis = typeof correlationHypotheses.$inferSelect;
export type CorrelationHypothesisInsert =
  typeof correlationHypotheses.$inferInsert;
export type Organization = typeof organizations.$inferSelect;
export type OrganizationInsert = typeof organizations.$inferInsert;
export type AuditEntry = typeof auditTrail.$inferSelect;
export type AuditEntryInsert = typeof auditTrail.$inferInsert;
