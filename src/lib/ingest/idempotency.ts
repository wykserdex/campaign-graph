import { db } from "@/db";
import { rawEvents } from "@/db/schema";
import { sql } from "drizzle-orm";

// ═══════════════════════════════════════════════════════════════════════════
// Idempotency layer — AT-LEAST-ONCE delivery + effectively-once processing
// ═══════════════════════════════════════════════════════════════════════════

/** Check if event was already processed by (sourceSystem, eventId) */
export async function isAlreadyProcessed(
  sourceSystem: string,
  eventId: string
): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT processing_status
    FROM raw_events
    WHERE source_system = ${sourceSystem}
      AND event_id = ${eventId}::uuid
    LIMIT 1
  `);
  const rows = result.rows as Array<{ processing_status: string }>;
  return rows.length > 0 && rows[0].processing_status === "processed";
}

/** Record raw event at start of processing */
export async function recordRawEvent(opts: {
  eventId: string;
  tenantId: string;
  eventType: string;
  sourceSystem: string;
  correlationId?: string | null;
  payload: Record<string, unknown>;
}): Promise<void> {
  await db.execute(sql`
    INSERT INTO raw_events (
      event_id, tenant_id, event_type, source_system,
      correlation_id, payload, processing_status, received_at
    ) VALUES (
      ${opts.eventId}::uuid,
      ${opts.tenantId}::uuid,
      ${opts.eventType},
      ${opts.sourceSystem},
      ${opts.correlationId ?? null},
      ${JSON.stringify(opts.payload)}::jsonb,
      'received',
      NOW()
    )
    ON CONFLICT (source_system, event_id) DO NOTHING
  `);
}

/** Mark event as processed */
export async function markProcessed(
  sourceSystem: string,
  eventId: string
): Promise<void> {
  await db.execute(sql`
    UPDATE raw_events
    SET processing_status = 'processed'
    WHERE source_system = ${sourceSystem}
      AND event_id = ${eventId}::uuid
  `);
}

/** Mark event as failed with error */
export async function markFailed(
  sourceSystem: string,
  eventId: string,
  error: string
): Promise<void> {
  await db.execute(sql`
    UPDATE raw_events
    SET processing_status = 'failed', processing_error = ${error}
    WHERE source_system = ${sourceSystem}
      AND event_id = ${eventId}::uuid
  `);
}
