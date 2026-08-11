import { NextRequest, NextResponse } from "next/server";
import { listPendingHypotheses } from "@/lib/graph/queries";

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
  const limit = Math.min(
    parseInt(url.searchParams.get("limit") ?? "50"),
    200
  );
  const offset = parseInt(url.searchParams.get("offset") ?? "0");

  const hypotheses = await listPendingHypotheses(tenantId, limit, offset);

  return NextResponse.json({
    data: hypotheses,
    meta: { limit, offset, count: hypotheses.length },
  });
}
