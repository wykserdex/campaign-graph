import { NextRequest } from "next/server";
import { getCampaignMemberEdges, getEvidenceByIds } from "@/lib/graph/queries";
import { db } from "@/db";
import { correlationHypotheses } from "@/db/schema";
import { and, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * Explains *why* a campaign exists: the confirmed/proposed hypotheses
 * (score, per-signal breakdown, contributing edges) plus the member edges
 * and the raw evidence backing them — the human-readable trail behind an
 * automated merge decision. Adapted to this build's schema (no `explanation` text column here, only
 * `scoreBreakdown` jsonb; evidence is looked up by evidence_id, not
 * embedded per-edge).
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const tenantId = req.nextUrl.searchParams.get("tenantId");
  if (!tenantId) {
    return Response.json(
      { ok: false, error: "tenantId query param required" },
      { status: 400 }
    );
  }

  const [memberEdges, hypotheses] = await Promise.all([
    getCampaignMemberEdges(tenantId, id),
    db
      .select()
      .from(correlationHypotheses)
      .where(
        and(
          eq(correlationHypotheses.tenantId, tenantId),
          eq(correlationHypotheses.campaignNodeId, id)
        )
      ),
  ]);

  const evidenceIds = Array.from(
    new Set(memberEdges.flatMap((e) => e.evidenceRefs ?? []))
  );
  const evidence = await getEvidenceByIds(tenantId, evidenceIds);

  return Response.json({
    ok: true,
    explanation: {
      memberEdges: memberEdges.map((e) => ({
        edgeId: e.edgeId,
        sourceNodeId: e.sourceNodeId,
        confidence: e.confidence,
        algorithm: e.algorithm,
        algorithmVersion: e.algorithmVersion,
      })),
      hypotheses: hypotheses.map((h) => ({
        hypothesisId: h.hypothesisId,
        status: h.status,
        score: h.score,
        scoreBreakdown: h.scoreBreakdown,
      })),
      evidence,
    },
  });
}
