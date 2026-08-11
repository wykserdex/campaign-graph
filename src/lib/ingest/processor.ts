import { db } from "@/db";
import type { GraphEvent, IngestResult } from "@/lib/domain/events";
import { upsertNode, upsertEdge, resolveNodeId } from "@/lib/graph/upsert";
import {
  isAlreadyProcessed,
  recordRawEvent,
  markProcessed,
  markFailed,
} from "./idempotency";
import { runCorrelationForNode } from "@/lib/correlation/engine";
import { redactDeep } from "@/lib/domain/pii";

// ═══════════════════════════════════════════════════════════════════════════
// Core ingestion processor
// Transactional: idempotency → upsert nodes → upsert edges → correlate
// ═══════════════════════════════════════════════════════════════════════════

export async function processGraphEvent(
  event: GraphEvent,
  rawPayload: Record<string, unknown>
): Promise<IngestResult> {
  const now = new Date(event.observedAt);

  // Step 1: Record raw event (idempotency check)
  await recordRawEvent({
    eventId: event.eventId,
    tenantId: event.tenantId,
    eventType: event.eventType,
    sourceSystem: event.sourceSystem,
    correlationId: event.correlationId,
    payload: rawPayload,
  });

  // Step 2: Idempotency check — if already processed, return early
  const alreadyDone = await isAlreadyProcessed(
    event.sourceSystem,
    event.eventId
  );
  if (alreadyDone) {
    return {
      eventId: event.eventId,
      status: "duplicate",
      nodesUpserted: 0,
      edgesUpserted: 0,
    };
  }

  try {
    // Step 3: Upsert all nodes
    const nodeIdMap = new Map<string, string>(); // canonicalKey → nodeId
    let nodesUpserted = 0;

    for (const entity of event.entities) {
      const nodeId = await upsertNode(event.tenantId, entity, now);
      nodeIdMap.set(`${entity.nodeType}:${entity.canonicalKey}`, nodeId);
      nodesUpserted++;
    }

    // Step 4: Upsert all edges
    let edgesUpserted = 0;
    const upsertedEdgeIds: string[] = [];

    for (const relation of event.relations) {
      let sourceNodeId = nodeIdMap.get(
        `${relation.sourceType}:${relation.sourceKey}`
      );
      let targetNodeId = nodeIdMap.get(
        `${relation.targetType}:${relation.targetKey}`
      );

      if (!sourceNodeId || !targetNodeId) {
        const resolvedSrc =
          sourceNodeId ??
          (await resolveNodeId(
            event.tenantId,
            relation.sourceType,
            relation.sourceKey
          ));
        const resolvedTgt =
          targetNodeId ??
          (await resolveNodeId(
            event.tenantId,
            relation.targetType,
            relation.targetKey
          ));

        if (!resolvedSrc || !resolvedTgt) {
          console.warn(
            `[processor] Cannot resolve nodes for ${relation.relationType}: ` +
              `${relation.sourceType}:${relation.sourceKey} → ${relation.targetType}:${relation.targetKey}`
          );
          continue;
        }
        sourceNodeId = resolvedSrc;
        targetNodeId = resolvedTgt;
      }

      const edgeId = await upsertEdge({
        tenantId: event.tenantId,
        sourceNodeId,
        targetNodeId,
        relation,
        sourceSystem: event.sourceSystem,
        evidenceIds: relation.evidenceIds,
        now,
      });
      upsertedEdgeIds.push(edgeId);
      edgesUpserted++;
    }

    // Step 5: Mark as processed
    await markProcessed(event.sourceSystem, event.eventId);

    // Step 6: Trigger correlation engine — AWAITED, not fire-and-forget.
    //
    // BUGFIX: this used to fire runCorrelationForNode for every upserted
    // node concurrently without awaiting ("fire-and-forget in MVP"). Since
    // createCampaignForNodes does a check-then-insert (query for an
    // existing campaign, then insert a new one if none found) with no
    // locking between the two steps, concurrent calls on nodes that
    // should end up in the same campaign could each see "no campaign yet"
    // at the same time and each create their own — confirmed in practice:
    // a single 8-node demo scenario produced 2-4 separate Campaign nodes
    // instead of 1, even with the transitive-closure fix in
    // createCampaignForNodes applied (that fix is still correct and
    // necessary — it's what makes a SEQUENTIAL run correlate properly —
    // but it can't help against a genuine race between concurrent calls).
    //
    // Trading ingest latency for correctness here: this blocks the
    // response until correlation for this event's nodes has completed,
    // which serializes calls that would otherwise race each other.
    for (const [, nodeId] of nodeIdMap) {
      try {
        await runCorrelationForNode(event.tenantId, nodeId);
      } catch (err) {
        const redacted = redactDeep(
          err instanceof Error ? err.message : String(err)
        );
        console.error(
          `[processor] Correlation error for node ${nodeId}: ${redacted}`
        );
      }
    }

    return {
      eventId: event.eventId,
      status: "processed",
      nodesUpserted,
      edgesUpserted,
    };
  } catch (error) {
    const errorMsg =
      error instanceof Error ? error.message : String(error);
    await markFailed(event.sourceSystem, event.eventId, errorMsg);
    return {
      eventId: event.eventId,
      status: "failed",
      nodesUpserted: 0,
      edgesUpserted: 0,
      error: errorMsg,
    };
  }
}
