import { NextRequest } from "next/server";
import { runCorrelationForNode } from "@/lib/correlation/engine";

export const dynamic = "force-dynamic";

/**
 * Manually re-trigger correlation for a specific node. This build's
 * engine (runCorrelationForNode) only operates per-node, not as a full
 * tenant sweep, so the endpoint is scoped accordingly rather than faking
 * a tenant-wide signature the engine doesn't actually support.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const tenantId = body.tenantId ?? req.nextUrl.searchParams.get("tenantId");
  const nodeId = body.nodeId ?? req.nextUrl.searchParams.get("nodeId");

  if (!tenantId || !nodeId) {
    return Response.json(
      { ok: false, error: "tenantId and nodeId are required" },
      { status: 400 }
    );
  }

  const result = await runCorrelationForNode(tenantId, nodeId);
  return Response.json({ ok: true, result });
}
