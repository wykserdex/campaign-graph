import { NextRequest, NextResponse } from "next/server";
import { listNodesByType } from "@/lib/graph/queries";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const tenantId = req.headers.get("x-tenant-id");
  if (!tenantId) {
    return NextResponse.json(
      { error: "X-Tenant-ID header required" },
      { status: 400 }
    );
  }

  const url = new URL(req.url);
  const nodeType = url.searchParams.get("type");
  if (!nodeType) {
    return NextResponse.json(
      { error: "?type= query parameter required (e.g. ?type=Repository)" },
      { status: 400 }
    );
  }

  const limit = Math.min(
    parseInt(url.searchParams.get("limit") ?? "50"),
    200
  );
  const offset = parseInt(url.searchParams.get("offset") ?? "0");

  const nodes = await listNodesByType(tenantId, nodeType, limit, offset);

  return NextResponse.json({
    data: nodes,
    meta: { type: nodeType, limit, offset, count: nodes.length },
  });
}
