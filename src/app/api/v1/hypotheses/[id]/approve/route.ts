import { NextRequest, NextResponse } from "next/server";
import { approveHypothesis } from "@/lib/correlation/hypotheses";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: RouteContext) {
  const tenantId = req.headers.get("x-tenant-id");
  if (!tenantId) {
    return NextResponse.json(
      { error: "X-Tenant-ID header required" },
      { status: 400 }
    );
  }

  const { id } = await ctx.params;

  try {
    const result = await approveHypothesis(tenantId, id);
    return NextResponse.json({
      message: "Hypothesis approved",
      campaignNodeId: result.campaignNodeId,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errorMsg }, { status: 400 });
  }
}
