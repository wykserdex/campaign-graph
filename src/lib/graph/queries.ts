import { db } from "@/db";
import { graphNodes, graphEdges, correlationHypotheses } from "@/db/schema";
import { sql, eq, and, desc, or } from "drizzle-orm";
import { SOURCE_SYSTEMS } from "@/lib/domain/enums";

// ═══════════════════════════════════════════════════════════════════════════
// Independent source count — §5.3: excludes __correlation_engine__
// ═══════════════════════════════════════════════════════════════════════════
export async function getIndependentSourceCount(
  tenantId: string,
  nodeId: string
): Promise<number> {
  const result = await db.execute(sql`
    SELECT COUNT(DISTINCT source_system) AS source_count
    FROM graph_edges
    WHERE tenant_id = ${tenantId}::uuid
      AND (source_node_id = ${nodeId}::uuid OR target_node_id = ${nodeId}::uuid)
      AND source_system != ${SOURCE_SYSTEMS.CORRELATION_ENGINE}
      AND status = 'active'
  `);
  const rows = result.rows as Array<{ source_count: string }>;
  return parseInt(rows[0]?.source_count ?? "0", 10);
}

// ═══════════════════════════════════════════════════════════════════════════
// Campaign timeline — all edges related to a campaign
// ═══════════════════════════════════════════════════════════════════════════
export async function getCampaignTimeline(
  tenantId: string,
  campaignNodeId: string
) {
  const memberEdges = await db
    .select()
    .from(graphEdges)
    .where(
      and(
        eq(graphEdges.tenantId, tenantId),
        eq(graphEdges.targetNodeId, campaignNodeId),
        eq(graphEdges.relationType, "MEMBER_OF_CAMPAIGN"),
        eq(graphEdges.status, "active")
      )
    );

  const memberNodeIds = memberEdges.map((e) => e.sourceNodeId);
  if (memberNodeIds.length === 0) return [];

  const memberArray =
    memberNodeIds.length > 0
      ? `ARRAY[${memberNodeIds.map((id) => `'${id}'::uuid`).join(",")}]`
      : "ARRAY[]::uuid[]";

  const result = await db.execute(sql`
    SELECT
      ge.edge_id, ge.relation_type, ge.edge_kind, ge.confidence,
      ge.source_system, ge.first_seen_at, ge.last_seen_at, ge.status,
      src.node_type AS source_type, src.canonical_key AS source_key,
      tgt.node_type AS target_type, tgt.canonical_key AS target_key
    FROM graph_edges ge
    JOIN graph_nodes src ON src.node_id = ge.source_node_id
    JOIN graph_nodes tgt ON tgt.node_id = ge.target_node_id
    WHERE ge.tenant_id = ${tenantId}::uuid
      AND ge.status = 'active'
      AND (
        ge.source_node_id = ANY(${sql.raw(memberArray)})
        OR ge.target_node_id = ANY(${sql.raw(memberArray)})
      )
    ORDER BY ge.last_seen_at DESC
    LIMIT 500
  `);
  return result.rows;
}

// ═══════════════════════════════════════════════════════════════════════════
// Get node with edges
// ═══════════════════════════════════════════════════════════════════════════
export async function getNodeWithEdges(tenantId: string, nodeId: string) {
  const [node] = await db
    .select()
    .from(graphNodes)
    .where(
      and(eq(graphNodes.tenantId, tenantId), eq(graphNodes.nodeId, nodeId))
    )
    .limit(1);
  if (!node) return null;

  const edges = await db
    .select()
    .from(graphEdges)
    .where(
      and(
        eq(graphEdges.tenantId, tenantId),
        or(
          eq(graphEdges.sourceNodeId, nodeId),
          eq(graphEdges.targetNodeId, nodeId)
        ),
        eq(graphEdges.status, "active")
      )
    );

  return { node, edges };
}

// ═══════════════════════════════════════════════════════════════════════════
// Find campaign for a node
// ═══════════════════════════════════════════════════════════════════════════
export async function findCampaignForNode(
  tenantId: string,
  nodeId: string
): Promise<string | null> {
  const result = await db.execute(sql`
    SELECT ge.target_node_id AS campaign_node_id
    FROM graph_edges ge
    JOIN graph_nodes gn ON gn.node_id = ge.target_node_id
    WHERE ge.tenant_id = ${tenantId}::uuid
      AND ge.source_node_id = ${nodeId}::uuid
      AND ge.relation_type = 'MEMBER_OF_CAMPAIGN'
      AND ge.status = 'active'
      AND gn.node_type = 'Campaign'
    LIMIT 1
  `);
  const rows = result.rows as Array<{ campaign_node_id: string }>;
  return rows.length > 0 ? rows[0].campaign_node_id : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Campaign sources (excluding correlation engine)
// ═══════════════════════════════════════════════════════════════════════════
export async function getCampaignSources(
  tenantId: string,
  campaignNodeId: string
): Promise<
  Array<{ sourceSystem: string; edgeCount: number; lastSeenAt: string }>
> {
  const result = await db.execute(sql`
    SELECT
      ge.source_system,
      COUNT(*) AS edge_count,
      MAX(ge.last_seen_at) AS last_seen_at
    FROM graph_edges ge
    WHERE ge.tenant_id = ${tenantId}::uuid
      AND ge.target_node_id = ${campaignNodeId}::uuid
      AND ge.source_system != ${SOURCE_SYSTEMS.CORRELATION_ENGINE}
      AND ge.status = 'active'
    GROUP BY ge.source_system
    ORDER BY last_seen_at DESC
  `);
  return (result.rows as Array<{
    source_system: string;
    edge_count: string;
    last_seen_at: string;
  }>).map((r) => ({
    sourceSystem: r.source_system,
    edgeCount: parseInt(r.edge_count, 10),
    lastSeenAt: r.last_seen_at,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// List campaigns for a tenant
// ═══════════════════════════════════════════════════════════════════════════
export async function listCampaigns(
  tenantId: string,
  limit = 50,
  offset = 0
) {
  return db
    .select()
    .from(graphNodes)
    .where(
      and(
        eq(graphNodes.tenantId, tenantId),
        eq(graphNodes.nodeType, "Campaign")
      )
    )
    .orderBy(desc(graphNodes.lastSeenAt))
    .limit(limit)
    .offset(offset);
}

// ═══════════════════════════════════════════════════════════════════════════
// List pending hypotheses
// ═══════════════════════════════════════════════════════════════════════════
export async function listPendingHypotheses(
  tenantId: string,
  limit = 50,
  offset = 0
) {
  return db
    .select()
    .from(correlationHypotheses)
    .where(
      and(
        eq(correlationHypotheses.tenantId, tenantId),
        eq(correlationHypotheses.status, "proposed")
      )
    )
    .orderBy(desc(correlationHypotheses.score))
    .limit(limit)
    .offset(offset);
}

// ═══════════════════════════════════════════════════════════════════════════
// List nodes by type
// ═══════════════════════════════════════════════════════════════════════════
export async function listNodesByType(
  tenantId: string,
  nodeType: string,
  limit = 50,
  offset = 0
) {
  return db
    .select()
    .from(graphNodes)
    .where(
      and(
        eq(graphNodes.tenantId, tenantId),
        eq(graphNodes.nodeType, nodeType)
      )
    )
    .orderBy(desc(graphNodes.lastSeenAt))
    .limit(limit)
    .offset(offset);
}

// ═══════════════════════════════════════════════════════════════════════════
// Member edges of a campaign (MEMBER_OF_CAMPAIGN only, not full timeline)
// ═══════════════════════════════════════════════════════════════════════════
export async function getCampaignMemberEdges(
  tenantId: string,
  campaignNodeId: string
) {
  return db
    .select()
    .from(graphEdges)
    .where(
      and(
        eq(graphEdges.tenantId, tenantId),
        eq(graphEdges.targetNodeId, campaignNodeId),
        eq(graphEdges.relationType, "MEMBER_OF_CAMPAIGN"),
        eq(graphEdges.status, "active")
      )
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// Evidence records by ID (for /explain — the human-readable trail behind a
// correlation decision)
// ═══════════════════════════════════════════════════════════════════════════
export async function getEvidenceByIds(tenantId: string, evidenceIds: string[]) {
  if (evidenceIds.length === 0) return [];
  const idArray = `ARRAY[${evidenceIds.map((id) => `'${id}'::uuid`).join(",")}]`;
  const result = await db.execute(sql`
    SELECT evidence_id, source_system, source_record_id, description, attributes, created_at
    FROM evidence_records
    WHERE tenant_id = ${tenantId}::uuid
      AND evidence_id = ANY(${sql.raw(idArray)})
  `);
  return result.rows;
}
// ═══════════════════════════════════════════════════════════════════════════
export async function findSharedFingerprint(
  tenantId: string,
  nodeType: string,
  canonicalKey: string
): Promise<Array<{ nodeId: string; sourceSystem: string }>> {
  const result = await db.execute(sql`
    SELECT gn.node_id, ge.source_system
    FROM graph_nodes gn
    JOIN graph_edges ge
      ON ge.source_node_id = gn.node_id OR ge.target_node_id = gn.node_id
    WHERE gn.tenant_id = ${tenantId}::uuid
      AND gn.node_type = ${nodeType}
      AND gn.canonical_key = ${canonicalKey}
      AND ge.source_system != ${SOURCE_SYSTEMS.CORRELATION_ENGINE}
      AND ge.status = 'active'
    GROUP BY gn.node_id, ge.source_system
  `);
  return (result.rows as Array<{ node_id: string; source_system: string }>).map(
    (r) => ({
      nodeId: r.node_id,
      sourceSystem: r.source_system,
    })
  );
}
