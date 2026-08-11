import { db } from "@/db";
import { correlationHypotheses, graphNodes } from "@/db/schema";
import { sql, eq, and } from "drizzle-orm";
import { SOURCE_SYSTEMS } from "@/lib/domain/enums";

// ═══════════════════════════════════════════════════════════════════════════
// Hypothesis Management
// Human-in-the-loop for medium-confidence correlations
// ═══════════════════════════════════════════════════════════════════════════

/** Create a correlation hypothesis (for medium confidence — §5.2) */
export async function createHypothesis(opts: {
  tenantId: string;
  score: number;
  contributingEdges: string[];
  scoreBreakdown: Record<string, number>;
  campaignNodeId?: string;
}): Promise<string> {
  const edgeArray = opts.contributingEdges.length > 0
    ? `{${opts.contributingEdges.map((id) => `"${id}"`).join(",")}}`
    : "{}";

  const result = await db.execute(sql`
    INSERT INTO correlation_hypotheses (
      hypothesis_id, tenant_id, campaign_node_id, status,
      score, contributing_edges, score_breakdown,
      created_at, updated_at
    ) VALUES (
      gen_random_uuid(),
      ${opts.tenantId}::uuid,
      ${opts.campaignNodeId ?? null},
      'proposed',
      ${opts.score},
      ${sql.raw(edgeArray)}::uuid[],
      ${JSON.stringify(opts.scoreBreakdown)}::jsonb,
      NOW(),
      NOW()
    )
    RETURNING hypothesis_id
  `);
  const rows = result.rows as Array<{ hypothesis_id: string }>;
  return rows[0].hypothesis_id;
}

/** Approve a hypothesis → creates Campaign node + MEMBER_OF_CAMPAIGN edges */
export async function approveHypothesis(
  tenantId: string,
  hypothesisId: string
): Promise<{ campaignNodeId: string }> {
  const [hypothesis] = await db
    .select()
    .from(correlationHypotheses)
    .where(
      and(
        eq(correlationHypotheses.tenantId, tenantId),
        eq(correlationHypotheses.hypothesisId, hypothesisId)
      )
    )
    .limit(1);

  if (!hypothesis) throw new Error(`Hypothesis ${hypothesisId} not found`);
  if (hypothesis.status !== "proposed") {
    throw new Error(
      `Hypothesis ${hypothesisId} not in proposed state (current: ${hypothesis.status})`
    );
  }

  let campaignNodeId = hypothesis.campaignNodeId;
  if (!campaignNodeId) {
    const campaignResult = await db.execute(sql`
      INSERT INTO graph_nodes (
        node_id, tenant_id, node_type, canonical_key, attributes,
        confidence, first_seen_at, last_seen_at, created_at, updated_at
      ) VALUES (
        gen_random_uuid(),
        ${tenantId}::uuid,
        'Campaign',
        gen_random_uuid()::text,
        ${JSON.stringify({
          hypothesis_id: hypothesisId,
          score: hypothesis.score,
          score_breakdown: hypothesis.scoreBreakdown,
          created_by: "analyst_approval",
        })}::jsonb,
        ${hypothesis.score},
        NOW(), NOW(), NOW(), NOW()
      )
      RETURNING node_id
    `);
    const campaignRows = campaignResult.rows as Array<{ node_id: string }>;
    campaignNodeId = campaignRows[0].node_id;
  }

  await db.execute(sql`
    UPDATE correlation_hypotheses
    SET status = 'confirmed',
        campaign_node_id = ${campaignNodeId}::uuid,
        updated_at = NOW()
    WHERE hypothesis_id = ${hypothesisId}::uuid
      AND tenant_id = ${tenantId}::uuid
  `);

  return { campaignNodeId };
}

/** Reject a hypothesis */
export async function rejectHypothesis(
  tenantId: string,
  hypothesisId: string
): Promise<void> {
  await db.execute(sql`
    UPDATE correlation_hypotheses
    SET status = 'rejected', updated_at = NOW()
    WHERE hypothesis_id = ${hypothesisId}::uuid
      AND tenant_id = ${tenantId}::uuid
      AND status = 'proposed'
  `);
}

/** Merge two hypotheses */
export async function mergeHypotheses(
  tenantId: string,
  primaryId: string,
  secondaryId: string
): Promise<void> {
  await db.execute(sql`
    UPDATE correlation_hypotheses
    SET status = 'merged', updated_at = NOW()
    WHERE hypothesis_id = ${secondaryId}::uuid
      AND tenant_id = ${tenantId}::uuid
  `);
}
