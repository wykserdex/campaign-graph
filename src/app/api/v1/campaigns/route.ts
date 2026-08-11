import { NextRequest, NextResponse } from "next/server";
import { listCampaigns } from "@/lib/graph/queries";

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

  const campaigns = await listCampaigns(tenantId, limit, offset);

  return NextResponse.json({
    data: campaigns,
    meta: { limit, offset, count: campaigns.length },
  });
}
