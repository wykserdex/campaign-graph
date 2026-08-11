import { db } from "@/db";
import { graphNodes } from "@/db/schema";
import { sql, eq, and } from "drizzle-orm";
import {
  signalSharedFingerprint,
  signalSharedDomain,
  signalSharedSubjectIndex,
  signalSharedActor,
  signalSharedTargetOrg,
  deltaHoursBetween,
} from "./signals";
import { scoreSignals, type ScoringResult } from "./scoring";
import { createHypothesis } from "./hypotheses";
import { SOURCE_SYSTEMS } from "@/lib/domain/enums";

// ═══════════════════════════════════════════════════════════════════════════
// Correlation Engine
// §5.3: ALL edges created by this engine use source_system = '__correlation_engine__'
// §5.3: Correlation engine does NOT count its own edges as independent sources
// ═══════════════════════════════════════════════════════════════════════════

export interface CorrelationRunResult {
  tenantId: string;
  nodesEvaluated: number;
  campaignsCreated: number;
  hypothesesCreated: number;
  edgesCreated: number;
}

/** Run correlation for a node that was just ingested/updated */
export async function runCorrelationForNode(
  tenantId: string,
  triggerNodeId: string
): Promise<CorrelationRunResult> {
  const result: CorrelationRunResult = {
    tenantId,
    nodesEvaluated: 0,
    campaignsCreated: 0,
    hypothesesCreated: 0,
    edgesCreated: 0,
  };

  const [triggerNode] = await db
    .select()
    .from(graphNodes)
    .where(
      and(
        eq(graphNodes.tenantId, tenantId),
        eq(graphNodes.nodeId, triggerNodeId)
      )
    )
    .limit(1);

  if (!triggerNode) return result;

  // Find candidate nodes with at least 1 real (non-corr-engine) edge
  const candidates = await db.execute(sql`
    SELECT DISTINCT gn.node_id, gn.node_type, gn.canonical_key, gn.last_seen_at
    FROM graph_nodes gn
    JOIN graph_edges ge
      ON (ge.source_node_id = gn.node_id OR ge.target_node_id = gn.node_id)
    WHERE gn.tenant_id = ${tenantId}::uuid
      AND gn.node_id != ${triggerNodeId}::uuid
      AND ge.source_system != ${SOURCE_SYSTEMS.CORRELATION_ENGINE}
      AND ge.status = 'active'
    LIMIT 100
  `);

  const candidateRows = candidates.rows as Array<{
    node_id: string;
    node_type: string;
    canonical_key: string;
    last_seen_at: string;
  }>;
  result.nodesEvaluated = candidateRows.length;

  for (const candidate of candidateRows) {
    if (candidate.node_id === triggerNodeId) continue;

    const deltaHours = deltaHoursBetween(
      new Date(triggerNode.lastSeenAt),
      new Date(candidate.last_seen_at)
    );

    const [s1, s2, s3, s4, s5] = await Promise.all([
      signalSharedFingerprint(tenantId, triggerNodeId, candidate.node_id),
      signalSharedDomain(tenantId, triggerNodeId, candidate.node_id, deltaHours),
      signalSharedSubjectIndex(tenantId, triggerNodeId, candidate.node_id, deltaHours),
      signalSharedActor(tenantId, triggerNodeId, candidate.node_id, deltaHours),
      signalSharedTargetOrg(tenantId, triggerNodeId, candidate.node_id, deltaHours),
    ]);

    const scoring = scoreSignals([s1, s2, s3, s4, s5]);

    if (scoring.decision === "merge") {
      const { edgesCreated: edgeCount, campaignCreated } = await createCampaignForNodes(
        tenantId,
        triggerNodeId,
        candidate.node_id,
        scoring
      );
      if (campaignCreated) {
        result.campaignsCreated++;
      }
      result.edgesCreated += edgeCount;
    } else if (scoring.decision === "review") {
      await createHypothesis({
        tenantId,
        score: scoring.score,
        contributingEdges: [],
        scoreBreakdown: scoring.breakdown,
      });
      result.hypothesesCreated++;
    }
  }

  return result;
}

/** Create Campaign and link nodes via MEMBER_OF_CAMPAIGN (§5.3 protected)
 *
 * BUGFIX: this used to only check whether nodeId1 OR nodeId2 THEMSELVES
 * had a direct MEMBER_OF_CAMPAIGN edge. Since runCorrelationForNode is
 * called once per node (not once per whole cluster), a node whose
 * strongest "merge" match happened to be evaluated in a different pairing
 * than its structurally-connected neighbor (e.g. via CONTAINS_COMMIT,
 * EXPOSED — non-correlator edges) could end up creating a brand new
 * Campaign even though it's already part of one transitively. Observed in
 * practice: a single internally-consistent demo scenario (repo leak +
 * leak-intelligence record + phishing URL, all sharing one domain)
 * fragmented into 3 separate Campaign nodes instead of 1.
 *
 * Fixed by checking the existing campaign across the whole reachable
 * subgraph from nodeId1/nodeId2 (any edge type, any direction), not just
 * the immediate pair — bounded to 4 hops so this stays cheap and can't
 * runaway on a densely-connected hub node.
 */
export async function createCampaignForNodes(
  tenantId: string,
  nodeId1: string,
  nodeId2: string,
  scoring: ScoringResult
): Promise<{ edgesCreated: number; campaignCreated: boolean }> {
  const now = new Date();

  // Check if EITHER node is transitively connected to an existing campaign
  // (not just directly linked to one itself).
  const existingCampaign = await db.execute(sql`
    WITH RECURSIVE reachable(node_id, depth) AS (
      SELECT ${nodeId1}::uuid, 0
      UNION
      SELECT ${nodeId2}::uuid, 0
      UNION
      SELECT
        CASE WHEN ge.source_node_id = r.node_id THEN ge.target_node_id ELSE ge.source_node_id END,
        r.depth + 1
      FROM graph_edges ge
      JOIN reachable r ON (ge.source_node_id = r.node_id OR ge.target_node_id = r.node_id)
      WHERE ge.tenant_id = ${tenantId}::uuid
        AND ge.status = 'active'
        AND r.depth < 4
    )
    SELECT DISTINCT gn.node_id AS campaign_node_id
    FROM reachable r
    JOIN graph_nodes gn ON gn.node_id = r.node_id
    WHERE gn.node_type = 'Campaign'
    LIMIT 1
  `);

  const existingRows = existingCampaign.rows as Array<{
    campaign_node_id: string;
  }>;

  let campaignNodeId: string;
  let campaignAlreadyExisted = false;
  if (existingRows.length > 0) {
    campaignNodeId = existingRows[0].campaign_node_id;
    campaignAlreadyExisted = true;
  } else {
    const campaignResult = await db.execute(sql`
      INSERT INTO graph_nodes (
        node_id, tenant_id, node_type, canonical_key,
        attributes, confidence, first_seen_at, last_seen_at,
        created_at, updated_at
      ) VALUES (
        gen_random_uuid(),
        ${tenantId}::uuid,
        'Campaign',
        gen_random_uuid()::text,
        ${JSON.stringify({
          correlation_score: scoring.score,
          score_breakdown: scoring.breakdown,
          created_by: SOURCE_SYSTEMS.CORRELATION_ENGINE,
          algorithm: "noisy-or-v1",
        })}::jsonb,
        ${scoring.score},
        ${now.toISOString()}::timestamptz,
        ${now.toISOString()}::timestamptz,
        ${now.toISOString()}::timestamptz,
        ${now.toISOString()}::timestamptz
      )
      RETURNING node_id
    `);
    const campaignRows = campaignResult.rows as Array<{ node_id: string }>;
    campaignNodeId = campaignRows[0].node_id;
  }

  let edgesCreated = 0;

  // MEMBER_OF_CAMPAIGN edges for both nodes (§5.3: __correlation_engine__)
  for (const nodeId of [nodeId1, nodeId2]) {
    await db.execute(sql`
      INSERT INTO graph_edges (
        edge_id, tenant_id, source_node_id, target_node_id,
        relation_type, edge_kind, confidence, evidence_refs,
        source_system, first_seen_at, last_seen_at, status,
        algorithm, algorithm_version, created_at, updated_at
      ) VALUES (
        gen_random_uuid(),
        ${tenantId}::uuid,
        ${nodeId}::uuid,
        ${campaignNodeId}::uuid,
        'MEMBER_OF_CAMPAIGN',
        'inferred',
        ${scoring.score},
        '{}'::uuid[],
        ${SOURCE_SYSTEMS.CORRELATION_ENGINE},
        ${now.toISOString()}::timestamptz,
        ${now.toISOString()}::timestamptz,
        'active',
        'noisy-or-v1',
        '1',
        ${now.toISOString()}::timestamptz,
        ${now.toISOString()}::timestamptz
      )
      ON CONFLICT (tenant_id, source_node_id, target_node_id, relation_type, source_system)
      DO UPDATE SET
        confidence = GREATEST(graph_edges.confidence, EXCLUDED.confidence),
        last_seen_at = GREATEST(graph_edges.last_seen_at, EXCLUDED.last_seen_at),
        updated_at = ${now.toISOString()}::timestamptz
    `);
    edgesCreated++;
  }

  // RELATED_TO edge between the two correlated nodes (§5.3)
  await db.execute(sql`
    INSERT INTO graph_edges (
      edge_id, tenant_id, source_node_id, target_node_id,
      relation_type, edge_kind, confidence, evidence_refs,
      source_system, first_seen_at, last_seen_at, status,
      algorithm, algorithm_version, created_at, updated_at
    ) VALUES (
      gen_random_uuid(),
      ${tenantId}::uuid,
      ${nodeId1}::uuid,
      ${nodeId2}::uuid,
      'RELATED_TO',
      'inferred',
      ${scoring.score},
      '{}'::uuid[],
      ${SOURCE_SYSTEMS.CORRELATION_ENGINE},
      ${now.toISOString()}::timestamptz,
      ${now.toISOString()}::timestamptz,
      'active',
      'noisy-or-v1',
      '1',
      ${now.toISOString()}::timestamptz,
      ${now.toISOString()}::timestamptz
    )
    ON CONFLICT (tenant_id, source_node_id, target_node_id, relation_type, source_system)
    DO UPDATE SET
      confidence = GREATEST(graph_edges.confidence, EXCLUDED.confidence),
      last_seen_at = GREATEST(graph_edges.last_seen_at, EXCLUDED.last_seen_at),
      updated_at = ${now.toISOString()}::timestamptz
  `);
  edgesCreated++;

  return { edgesCreated, campaignCreated: !campaignAlreadyExisted };
}

/** §5.3 REGRESSION TEST HELPER: count independent sources excluding corr engine */
export async function countIndependentSources(
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
