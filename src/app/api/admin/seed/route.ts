import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { adaptSecretExposureDetected } from "@/lib/ingest/adapters/secret_exposure";
import {
  adaptExposureObserved,
  adaptExposureAssessed,
} from "@/lib/ingest/adapters/leak_intelligence";
import { adaptUntilPhishEvent } from "@/lib/ingest/adapters/untilphish";
import { processGraphEvent } from "@/lib/ingest/processor";
import { resolveNodeId } from "@/lib/graph/upsert";
import { runCorrelationForNode } from "@/lib/correlation/engine";
import { canonicalDomain } from "@/lib/domain/canonical";
import type { GraphEvent } from "@/lib/domain/events";

export const dynamic = "force-dynamic";

/**
 * Idempotent-ish demo bootstrap for local dev: ingests one small,
 * internally-consistent multi-source scenario for a given tenant (all
 * three sources reference the same domain, "evil-demo-corp.example"), then
 * runs correlation on the resulting nodes so a Campaign actually forms.
 *
 * Note: processGraphEvent() already triggers correlation internally per
 * ingested node, but as fire-and-forget (not awaited) — by design, so
 * ingestion latency isn't blocked on correlation. That means relying on it
 * alone wouldn't guarantee a fully-formed campaign by the time this
 * endpoint responds. So here we resolve each event's node IDs by
 * canonical_key afterwards and re-run correlation explicitly, awaited, so
 * the response actually reflects the final state.
 */
async function ingestAndCollectNodeIds(event: GraphEvent, rawPayload: Record<string, unknown>) {
  await processGraphEvent(event, rawPayload);
  const nodeIds: string[] = [];
  for (const entity of event.entities) {
    const nodeId = await resolveNodeId(event.tenantId, entity.nodeType, entity.canonicalKey);
    if (nodeId) nodeIds.push(nodeId);
  }
  return nodeIds;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const tenantId = body.tenantId;
  if (!tenantId) {
    return Response.json(
      { ok: false, error: "tenantId is required (create one via POST /api/v1/tenants first)" },
      { status: 400 }
    );
  }

  const receivedAt = new Date().toISOString();
  const demoDomain = "evil-demo-corp.example";
  const repoId = `demo-org/leaky-repo-${randomUUID().slice(0, 6)}`;
  const allNodeIds: string[] = [];
  const ingested: Array<{ source: string; nodeCount: number }> = [];

  // 1. Secret-Exposure-Monitor: a leaked API key in a commit
  const secretRaw = {
    event_id: randomUUID(),
    tenant_id: tenantId,
    repository_id: repoId,
    repository_provider: "github",
    commit_sha: randomUUID().replace(/-/g, "").slice(0, 40),
    secret_type: "api_key",
    fingerprint: `demo-fp-${randomUUID()}`,
    finding_confidence: 0.9,
    attributes: { demo_domain: demoDomain },
  };
  const secretEvent = adaptSecretExposureDetected(secretRaw, receivedAt);
  const secretNodeIds = await ingestAndCollectNodeIds(secretEvent, secretRaw);
  allNodeIds.push(...secretNodeIds);
  ingested.push({ source: "secret-exposure-monitor", nodeCount: secretNodeIds.length });

  // 2. Leak-Intelligence: a subject index observed in a leak, tagged with
  //    the same domain so it correlates with (1) and (3)
  const leakSourceRecordId = `leak-${randomUUID().slice(0, 8)}`;
  const leakRaw = {
    event_id: randomUUID(),
    tenant_id: tenantId,
    source_id: "demo-leak-source",
    source_record_id: leakSourceRecordId,
    subject_indexes: [{ digest: `demo-subject-${randomUUID()}`, type: "email" }],
    exposed_types: ["email", "password_hash"],
    attributes: { domain: demoDomain },
  };
  const leakEvent = adaptExposureObserved(leakRaw, receivedAt);
  const leakNodeIds = await ingestAndCollectNodeIds(leakEvent, leakRaw);
  allNodeIds.push(...leakNodeIds);
  ingested.push({ source: "leak-intelligence", nodeCount: leakNodeIds.length });

  const assessRaw = {
    event_id: randomUUID(),
    tenant_id: tenantId,
    source_id: "demo-leak-source",
    source_record_id: leakSourceRecordId,
    risk_score: 0.8,
    status: "confirmed",
    exposed_types: ["email", "password_hash"],
  };
  const assessEvent = adaptExposureAssessed(assessRaw, receivedAt);
  await processGraphEvent(assessEvent, assessRaw);

  // 3. UntilPhish-Go: a phishing URL on the same domain
  const phishRaw = {
    event_id: randomUUID(),
    url: `https://${demoDomain}/login`,
    domain: canonicalDomain(demoDomain),
    verdict: "malicious",
    source_platform: "untilphish",
    author_id: "demo-actor-1",
  };
  const phishEvent = adaptUntilPhishEvent(phishRaw, receivedAt, tenantId);
  const phishNodeIds = await ingestAndCollectNodeIds(phishEvent, phishRaw);
  allNodeIds.push(...phishNodeIds);
  ingested.push({ source: "until-phish", nodeCount: phishNodeIds.length });

  // Explicit, awaited correlation pass — see note above on why the
  // fire-and-forget pass inside processGraphEvent isn't sufficient here.
  const uniqueNodeIds = Array.from(new Set(allNodeIds));
  const correlationResults = [];
  for (const nodeId of uniqueNodeIds) {
    correlationResults.push(await runCorrelationForNode(tenantId, nodeId));
  }

  return Response.json({
    ok: true,
    tenantId,
    ingested,
    correlation: correlationResults,
  });
}
