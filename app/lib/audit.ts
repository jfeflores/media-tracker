import { getD1Binding } from "@/db";
import { requestActorHash } from "@/app/lib/owner-auth";

export type AuditAction =
  | "media_created"
  | "media_updated"
  | "media_deleted"
  | "metadata_synced"
  | "metadata_failed"
  | "collection_created"
  | "collection_updated"
  | "collection_deleted"
  | "collection_reordered"
  | "collection_membership_updated"
  | "data_exported_json"
  | "data_exported_csv";

export type AuditEvent = {
  action: AuditAction;
  mediaItemId: string | null;
};

export async function recordAuditEvent(
  request: Request,
  action: AuditAction,
  mediaItemId: string | null,
) {
  return recordAuditEvents(request, [{ action, mediaItemId }]);
}

export async function recordAuditEvents(request: Request, events: AuditEvent[]) {
  if (!events.length) return;
  try {
    const [d1, actorHash] = await Promise.all([getD1Binding(), requestActorHash(request)]);
    const insert = d1.prepare(`INSERT INTO audit_events
      (id, action, media_item_id, actor_hash) VALUES (?, ?, ?, ?)`);
    await d1.batch(events.map(({ action, mediaItemId }) => insert.bind(
      crypto.randomUUID(),
      action,
      mediaItemId?.slice(0, 100) ?? null,
      actorHash,
    )));
  } catch (error) {
    console.warn("Audit event could not be recorded", {
      actions: [...new Set(events.map((event) => event.action))],
      error: error instanceof Error ? error.name : "UnknownError",
    });
  }
}
