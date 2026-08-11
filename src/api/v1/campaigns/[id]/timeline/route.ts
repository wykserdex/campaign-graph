import { NextRequest, NextResponse } from "next/server";
import { getCampaignTimeline } from "@/lib/graph/queries";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: RouteContext) {
  const tenantId = req.headers.get("x-tenant-id");
  if (!tenantId) {
    return NextResponse.json(
      { error: "X-Tenant-ID header required" },
      { status: 400 }
    );
  }

  const { id } = await ctx.params;
  const timeline = await getCampaignTimeline(tenantId, id);

  return NextResponse.json({ data: timeline });
}
