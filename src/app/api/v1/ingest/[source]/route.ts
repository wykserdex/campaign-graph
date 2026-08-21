import { NextRequest, NextResponse } from "next/server";
import { adaptSecretExposureDetected } from "@/lib/ingest/adapters/secret_exposure";
import {
  adaptExposureObserved,
  adaptExposureAssessed,
} from "@/lib/ingest/adapters/leak_intelligence";
import { adaptUntilPhishEvent } from "@/lib/ingest/adapters/untilphish";
import { processGraphEvent } from "@/lib/ingest/processor";
import { authenticateIngestRequest } from "@/lib/ingest/auth";
import { SOURCE_SYSTEMS } from "@/lib/domain/enums";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ source: string }> };

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { source } = await ctx.params;
  const receivedAt = new Date().toISOString();

  // Ingestion writes straight into the graph, so it is authenticated before
  // anything else — including before the body is parsed.
  const auth = await authenticateIngestRequest(req.headers, source);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    let graphEvent;
    switch (source) {
      case "secret-exposure-monitor": {
        graphEvent = adaptSecretExposureDetected(body, receivedAt);
        break;
      }
      case "leak-intelligence": {
        const eventType = (body.event_type as string) ?? "";
        if (
          eventType === "ExposureAssessed"
        ) {
          graphEvent = adaptExposureAssessed(body, receivedAt);
        } else {
          graphEvent = adaptExposureObserved(body, receivedAt);
        }
        break;
      }
      case "until-phish": {
        // The authenticated key already identifies the tenant; the header is
        // kept as a fallback only for keys minted before scoping existed.
        const tenantId =
          auth.tenantId ??
          req.headers.get("x-tenant-id") ??
          (body.tenant_id as string | undefined);
        if (!tenantId) {
          return NextResponse.json(
            {
              error:
                "tenant_id required via X-Tenant-ID header for until-phish events (§7.5)",
            },
            { status: 400 }
          );
        }
        graphEvent = adaptUntilPhishEvent(body, receivedAt, tenantId);
        break;
      }
      default:
        return NextResponse.json(
          {
            error: `Unknown source: ${source}. Valid: secret-exposure-monitor, leak-intelligence, until-phish`,
          },
          { status: 404 }
        );
    }

    const result = await processGraphEvent(graphEvent, body);
    const statusCode = result.status === "failed" ? 500 : 200;
    return NextResponse.json(result, { status: statusCode });
  } catch (error) {
    console.error(`[ingest/${source}] Error:`, error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Ingestion failed", details: errorMsg },
      { status: 422 }
    );
  }
}
