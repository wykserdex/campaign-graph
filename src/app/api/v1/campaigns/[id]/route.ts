import { NextRequest, NextResponse } from "next/server";
import { getNodeWithEdges } from "@/lib/graph/queries";

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
  const data = await getNodeWithEdges(tenantId, id);

  if (!data) {
    return NextResponse.json(
      { error: "Campaign not found" },
      { status: 404 }
    );
  }

  return NextResponse.json(data);
}
