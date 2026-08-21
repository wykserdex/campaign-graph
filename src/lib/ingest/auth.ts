import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { ingestionApiKeys } from "@/db/schema";

/**
 * Authentication for POST /api/v1/ingest/[source].
 *
 * Keys are minted by POST /api/v1/tenants as `sk_<source-system>_<hex>` and
 * stored only as a SHA-256 hex digest (see ingestionApiKeys.keyHash), so the
 * lookup here hashes the presented key and matches on that column — the
 * plaintext value never exists server-side after issuance.
 *
 * A key is scoped to exactly one source system: a leak-intelligence key must
 * not be able to write until-phish nodes into the graph, otherwise a single
 * leaked integration credential lets an attacker forge evidence for any
 * source and poison correlation across the whole tenant.
 */

export type IngestAuthSuccess = {
  ok: true;
  tenantId: string;
  apiKeyId: string;
  sourceSystem: string;
};

export type IngestAuthFailure = {
  ok: false;
  status: 401 | 403;
  error: string;
};

export type IngestAuthResult = IngestAuthSuccess | IngestAuthFailure;

export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

/** Accepts `Authorization: Bearer <key>` or `X-API-Key: <key>`. */
export function extractApiKey(headers: Headers): string | null {
  const authorization = headers.get("authorization");
  if (authorization && /^bearer\s+/i.test(authorization)) {
    const value = authorization.replace(/^bearer\s+/i, "").trim();
    if (value) return value;
  }

  const apiKeyHeader = headers.get("x-api-key");
  if (apiKeyHeader?.trim()) return apiKeyHeader.trim();

  return null;
}

export async function authenticateIngestRequest(
  headers: Headers,
  source: string
): Promise<IngestAuthResult> {
  const rawKey = extractApiKey(headers);
  if (!rawKey) {
    return {
      ok: false,
      status: 401,
      error:
        "Missing ingestion API key. Send it as 'Authorization: Bearer <key>' or 'X-API-Key: <key>'.",
    };
  }

  const rows = await db
    .select()
    .from(ingestionApiKeys)
    .where(
      and(
        eq(ingestionApiKeys.keyHash, hashApiKey(rawKey)),
        eq(ingestionApiKeys.isActive, true)
      )
    )
    .limit(1);

  const key = rows[0];
  if (!key) {
    // Unknown and revoked keys are deliberately indistinguishable.
    return { ok: false, status: 401, error: "Invalid or revoked API key." };
  }

  if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) {
    return { ok: false, status: 401, error: "API key has expired." };
  }

  if (key.sourceSystem !== source) {
    return {
      ok: false,
      status: 403,
      error: `API key is scoped to source '${key.sourceSystem}' and cannot ingest '${source}' events.`,
    };
  }

  // Best-effort audit trail: a failed bookkeeping write must not reject an
  // otherwise valid ingestion.
  try {
    await db
      .update(ingestionApiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(ingestionApiKeys.apiKeyId, key.apiKeyId));
  } catch (error) {
    console.error("[ingest/auth] failed to update lastUsedAt:", error);
  }

  return {
    ok: true,
    tenantId: key.tenantId,
    apiKeyId: key.apiKeyId,
    sourceSystem: key.sourceSystem,
  };
}
