import { getD1Binding } from "@/db";
import { guardApiRequest } from "@/app/lib/api-security";

export const dynamic = "force-dynamic";

type EventCount = { event_type: string; total: number };

export async function GET(request: Request) {
  const blocked = await guardApiRequest(request, "security");
  if (blocked) return blocked;

  try {
    const d1 = await getD1Binding();
    const [eventRows, mediaSummary, lastEvent, integrity, auditSummary] = await Promise.all([
      d1.prepare(`SELECT event_type, COUNT(*) AS total
        FROM security_events
        WHERE julianday(created_at) >= julianday('now', '-1 day')
        GROUP BY event_type`)
        .all<EventCount>(),
      d1.prepare(`SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
          SUM(CASE WHEN status = 'finished' THEN 1 ELSE 0 END) AS finished,
          SUM(CASE WHEN tier = 'unranked' THEN 1 ELSE 0 END) AS unranked
        FROM media_items`)
        .first<{ total: number; in_progress: number; finished: number; unranked: number }>(),
      d1.prepare("SELECT event_type, created_at FROM security_events ORDER BY created_at DESC LIMIT 1")
        .first<{ event_type: string; created_at: string }>(),
      d1.prepare("SELECT 1 AS ok").first<{ ok: number }>(),
      d1.prepare(`SELECT COUNT(*) AS total FROM audit_events
        WHERE julianday(created_at) >= julianday('now', '-1 day')`)
        .first<{ total: number }>(),
    ]);

    const events = Object.fromEntries(
      eventRows.results.map((row: EventCount) => [row.event_type, Number(row.total)]),
    ) as Record<string, number>;
    const databaseResponding = integrity?.ok === 1;
    const blocked24h = Object.values(events).reduce((total, count) => total + count, 0);

    return Response.json(
      {
        security: {
          blocked24h,
          rateLimited24h: events.rate_limited ?? 0,
          unauthorized24h: events.unauthorized ?? 0,
          crossOrigin24h: events.cross_origin_write ?? 0,
          invalidRequests24h:
            (events.invalid_json ?? 0)
            + (events.invalid_content_type ?? 0)
            + (events.payload_too_large ?? 0),
          lastEventAt: lastEvent?.created_at ?? null,
          auditedChanges24h: Number(auditSummary?.total ?? 0),
        },
        database: {
          status: databaseResponding ? "healthy" : "attention",
          integrity: databaseResponding ? "query verified" : "unavailable",
          records: Number(mediaSummary?.total ?? 0),
          inProgress: Number(mediaSummary?.in_progress ?? 0),
          finished: Number(mediaSummary?.finished ?? 0),
          unranked: Number(mediaSummary?.unranked ?? 0),
        },
        access: {
          mode: "Owner only",
          authenticated: true,
          ownerVerified: true,
        },
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    console.error("Security metrics failed", { name: error instanceof Error ? error.name : "UnknownError" });
    return Response.json(
      { error: "Security status is temporarily unavailable." },
      { status: 500 },
    );
  }
}
