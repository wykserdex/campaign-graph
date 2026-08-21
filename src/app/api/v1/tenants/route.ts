import { randomUUID, randomBytes, createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { db } from "@/db";
import { ingestionApiKeys, tenants } from "@/db/schema";
import { SOURCE_SYSTEMS } from "@/lib/domain/enums";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await db.select().from(tenants);
  return Response.json({ ok: true, tenants: rows });
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || randomUUID().slice(0, 8)
  );
}

/**
 * Creates a new tenant plus one ingestion API key per real source system
 * (excluding the reserved correlation-engine identity), adapted to
 * this build's schema: tenants here
 * require a unique `slug`, and ingestionApiKeys stores keyHash/keyPrefix
 * (SHA-256), not the raw key — the raw value is returned exactly once in
 * this response and is not recoverable afterwards.
 *
 * These keys are enforced by /api/v1/ingest/[source] via
 * src/lib/ingest/auth.ts: each key authenticates exactly one source system
 * and carries the tenant identity for the events it submits.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const name =
    typeof body.name === "string" && body.name.trim()
      ? body.name.trim()
      : `Tenant ${randomUUID().slice(0, 8)}`;

  const tenantId = randomUUID();
  const slug = slugify(name) + "-" + tenantId.slice(0, 8);
  const now = new Date();

  await db
    .insert(tenants)
    .values({ tenantId, name, slug, createdAt: now, updatedAt: now });

  const sources = Object.values(SOURCE_SYSTEMS).filter(
    (s) => s !== SOURCE_SYSTEMS.CORRELATION_ENGINE
  );

  const keys = await Promise.all(
    sources.map(async (sourceSystem) => {
      const rawKey = `sk_${sourceSystem}_${randomBytes(24).toString("hex")}`;
      const keyHash = createHash("sha256").update(rawKey).digest("hex");
      const keyPrefix = rawKey.slice(0, 12);

      await db.insert(ingestionApiKeys).values({
        apiKeyId: randomUUID(),
        tenantId,
        keyHash,
        keyPrefix,
        sourceSystem,
        createdAt: now,
      });

      // rawKey is returned once, here, and never persisted in plaintext.
      return { sourceSystem, apiKey: rawKey };
    })
  );

  return Response.json(
    { ok: true, tenant: { tenantId, name, slug }, apiKeys: keys },
    { status: 201 }
  );
}
