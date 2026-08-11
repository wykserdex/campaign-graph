import { db } from "@/db";
import { graphNodes, graphEdges } from "@/db/schema";
import { sql, eq, and } from "drizzle-orm";
import type { EntityRef, RelationRef } from "@/lib/domain/events";

// ═══════════════════════════════════════════════════════════════════════════
// Atomic Upsert
// Uses INSERT ... ON CONFLICT for idempotent merge
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Upsert a graph node by (tenantId, nodeType, canonicalKey).
 * Merge strategy: confidence = max(existing, new), attributes merged (new wins).
 * Returns the node_id of the inserted or existing node.
 */
export async function upsertNode(
  tenantId: string,
  entity: EntityRef,
  now: Date
): Promise<string> {
  const result = await db.execute(sql`
    INSERT INTO graph_nodes (
      node_id, tenant_id, node_type, canonical_key,
      attributes, confidence, first_seen_at, last_seen_at,
      created_at, updated_at
    ) VALUES (
      gen_random_uuid(),
      ${tenantId}::uuid,
      ${entity.nodeType},
      ${entity.canonicalKey},
      ${JSON.stringify(entity.attributes)}::jsonb,
      ${entity.confidence ?? null},
      ${now.toISOString()}::timestamptz,
      ${now.toISOString()}::timestamptz,
      ${now.toISOString()}::timestamptz,
      ${now.toISOString()}::timestamptz
    )
    ON CONFLICT (tenant_id, node_type, canonical_key)
    DO UPDATE SET
      attributes = graph_nodes.attributes || EXCLUDED.attributes,
      confidence = GREATEST(
        COALESCE(graph_nodes.confidence, 0),
        COALESCE(EXCLUDED.confidence, 0)
      ),
      last_seen_at = GREATEST(graph_nodes.last_seen_at, EXCLUDED.last_seen_at),
      updated_at = ${now.toISOString()}::timestamptz
    RETURNING node_id
  `);
  const rows = result.rows as Array<{ node_id: string }>;
  return rows[0].node_id;
}

/**
 * Upsert a graph edge by (tenantId, sourceNodeId, targetNodeId, relationType, sourceSystem).
 * Merge strategy: confidence = max, evidence_refs = distinct union, last_seen_at updated.
 */
export async function upsertEdge(opts: {
  tenantId: string;
  sourceNodeId: string;
  targetNodeId: string;
  relation: RelationRef;
  sourceSystem: string;
  evidenceIds: string[];
  now: Date;
}): Promise<string> {
  const {
    tenantId,
    sourceNodeId,
    targetNodeId,
    relation,
    sourceSystem,
    evidenceIds,
    now,
  } = opts;

  const evidenceArray = `{${evidenceIds.map((id) => `"${id}"`).join(",")}}`;

  const result = await db.execute(sql`
    INSERT INTO graph_edges (
      edge_id, tenant_id, source_node_id, target_node_id,
      relation_type, edge_kind, confidence, evidence_refs,
      source_system, first_seen_at, last_seen_at,
      expires_at, status, algorithm, algorithm_version,
      created_at, updated_at
    ) VALUES (
      gen_random_uuid(),
      ${tenantId}::uuid,
      ${sourceNodeId}::uuid,
      ${targetNodeId}::uuid,
      ${relation.relationType},
      ${relation.edgeKind},
      ${relation.confidence},
      ${evidenceArray}::uuid[],
      ${sourceSystem},
      ${now.toISOString()}::timestamptz,
      ${now.toISOString()}::timestamptz,
      ${relation.expiresAt ?? null},
      'active',
      ${relation.algorithm ?? null},
      ${relation.algorithmVersion ?? null},
      ${now.toISOString()}::timestamptz,
      ${now.toISOString()}::timestamptz
    )
    ON CONFLICT (tenant_id, source_node_id, target_node_id, relation_type, source_system)
    DO UPDATE SET
      confidence = GREATEST(graph_edges.confidence, EXCLUDED.confidence),
      evidence_refs = (
        SELECT ARRAY_AGG(DISTINCT e)
        FROM UNNEST(graph_edges.evidence_refs || EXCLUDED.evidence_refs) AS e
      ),
      last_seen_at = GREATEST(graph_edges.last_seen_at, EXCLUDED.last_seen_at),
      updated_at = ${now.toISOString()}::timestamptz
    RETURNING edge_id
  `);
  const rows = result.rows as Array<{ edge_id: string }>;
  return rows[0].edge_id;
}

/**
 * Resolve node_id from (tenantId, nodeType, canonicalKey).
 * Returns null if not found.
 */
export async function resolveNodeId(
  tenantId: string,
  nodeType: string,
  canonicalKey: string
): Promise<string | null> {
  const rows = await db
    .select({ nodeId: graphNodes.nodeId })
    .from(graphNodes)
    .where(
      and(
        eq(graphNodes.tenantId, tenantId),
        eq(graphNodes.nodeType, nodeType),
        eq(graphNodes.canonicalKey, canonicalKey)
      )
    )
    .limit(1);
  return rows.length > 0 ? rows[0].nodeId : null;
}

/**
 * Enrich/update node attributes (partial merge).
 */
export async function enrichNodeAttributes(
  tenantId: string,
  nodeId: string,
  additionalAttrs: Record<string, unknown>,
  now: Date
): Promise<void> {
  await db.execute(sql`
    UPDATE graph_nodes
    SET
      attributes = attributes || ${JSON.stringify(additionalAttrs)}::jsonb,
      updated_at = ${now.toISOString()}::timestamptz
    WHERE node_id = ${nodeId}::uuid
      AND tenant_id = ${tenantId}::uuid
  `);
}
