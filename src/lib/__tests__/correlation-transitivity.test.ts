import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { tenants } from "@/db/schema";
import { upsertNode } from "@/lib/graph/upsert";
import { createCampaignForNodes } from "@/lib/correlation/engine";
import { sql } from "drizzle-orm";
import type { EntityRef } from "@/lib/domain/events";
import type { ScoringResult } from "@/lib/correlation/scoring";

/**
 * Regression test for a real bug found while manually verifying this
 * merged build end-to-end (a single internally-consistent 8-node demo
 * scenario fragmented into 3 separate Campaign nodes instead of 1):
 *
 * createCampaignForNodes() used to only check whether the CURRENT PAIR of
 * nodes (nodeId1, nodeId2) already had a direct MEMBER_OF_CAMPAIGN edge —
 * not whether either node was already part of a campaign TRANSITIVELY via
 * a different pairing. Since runCorrelationForNode is invoked once per
 * node (not once per whole cluster), a chain A-B, then separately B-C,
 * evaluated as two independent merge decisions, could each create their
 * own Campaign instead of the second one reusing the first — exactly the
 * kind of bug §5.3 in the plan already warned about for a different
 * mechanism (self-reinforcement), but this is campaign fragmentation.
 *
 * This test calls createCampaignForNodes directly (white-box) rather than
 * going through the full signal-scoring pipeline (runCorrelationForNode),
 * because reliably triggering a specific real signal (S1-S5) end-to-end
 * turned out to require modeling this build's exact signal semantics
 * precisely (e.g. S1 checks two DIFFERENT node_ids sharing one
 * canonical_key, which the DB's own UNIQUE constraint makes structurally
 * impossible — that's arguably a separate, smaller finding, not chased
 * further here). Testing the merge/reuse decision directly is simpler and
 * exercises exactly the code path that had the bug.
 */

const TEST_TENANT_ID = randomUUID();

beforeAll(async () => {
  const now = new Date();
  await db.insert(tenants).values({
    tenantId: TEST_TENANT_ID,
    name: "Campaign Reuse Test Tenant",
    slug: `campaign-reuse-test-${TEST_TENANT_ID.slice(0, 8)}`,
    createdAt: now,
    updatedAt: now,
  });
});

async function makeNode(nodeType: string, canonicalKey: string) {
  const now = new Date();
  const entity: EntityRef = { nodeType, canonicalKey, attributes: {} };
  return upsertNode(TEST_TENANT_ID, entity, now);
}

function fakeScoring(): ScoringResult {
  return {
    score: 0.9,
    signals: [],
    breakdown: {},
    decision: "merge",
  };
}

async function countDistinctCampaigns(nodeIds: string[]) {
  const idArray = `ARRAY[${nodeIds.map((id) => `'${id}'::uuid`).join(",")}]`;
  const result = await db.execute(sql`
    SELECT DISTINCT ge.target_node_id AS campaign_id
    FROM graph_edges ge
    WHERE ge.tenant_id = ${TEST_TENANT_ID}::uuid
      AND ge.relation_type = 'MEMBER_OF_CAMPAIGN'
      AND ge.source_node_id = ANY(${sql.raw(idArray)})
  `);
  return new Set(
    (result.rows as Array<{ campaign_id: string }>).map((r) => r.campaign_id)
  ).size;
}

describe("createCampaignForNodes — transitive campaign reuse", () => {
  it("A-B merge then, separately, B-C merge: A, B, and C end up in ONE campaign, not two", async () => {
    const suffix = randomUUID().slice(0, 8);
    const nodeA = await makeNode("Repository", `test:repo-${suffix}-a`);
    const nodeB = await makeNode("Commit", `test:repo-${suffix}-a:commit-b`);
    const nodeC = await makeNode(
      "SecretFingerprint",
      `hmac:secret:v1:test-${suffix}-c`
    );

    await createCampaignForNodes(TEST_TENANT_ID, nodeA, nodeB, fakeScoring());
    await createCampaignForNodes(TEST_TENANT_ID, nodeB, nodeC, fakeScoring());

    const distinctCount = await countDistinctCampaigns([nodeA, nodeB, nodeC]);
    expect(distinctCount).toBe(1);
  });

  it("reuses an existing campaign transitively even when neither node in the new pair was previously a direct campaign member", async () => {
    const suffix = randomUUID().slice(0, 8);
    const nodeA = await makeNode("Repository", `test:repo2-${suffix}-a`);
    const nodeB = await makeNode("Commit", `test:repo2-${suffix}-a:commit-b`);
    const nodeD = await makeNode("Commit", `test:repo2-${suffix}-a:commit-d`);
    const nodeE = await makeNode(
      "SecretFingerprint",
      `hmac:secret:v1:test2-${suffix}-e`
    );

    await createCampaignForNodes(TEST_TENANT_ID, nodeA, nodeB, fakeScoring());

    const now = new Date();
    await db.execute(sql`
      INSERT INTO graph_edges (
        edge_id, tenant_id, source_node_id, target_node_id,
        relation_type, edge_kind, confidence, evidence_refs,
        source_system, first_seen_at, last_seen_at, status,
        created_at, updated_at
      ) VALUES (
        gen_random_uuid(), ${TEST_TENANT_ID}::uuid,
        ${nodeD}::uuid, ${nodeA}::uuid,
        'CONTAINS_COMMIT', 'observed', 1.0, '{}'::uuid[],
        'secret-exposure-monitor',
        ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz,
        'active', ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz
      )
    `);

    await createCampaignForNodes(TEST_TENANT_ID, nodeD, nodeE, fakeScoring());

    const distinctCount = await countDistinctCampaigns([nodeA, nodeB, nodeD, nodeE]);
    expect(distinctCount).toBe(1);
  });
});
