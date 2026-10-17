import { desc } from "drizzle-orm";
import { getDb } from "@/db";
import { mediaItems } from "@/db/schema";
import { guardApiRequest, readJsonObject } from "@/app/lib/api-security";
import { parseMediaPayload, routeError, rowValues, toMediaItem } from "./helpers";
import { recordAuditEvent } from "@/app/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const blocked = await guardApiRequest(request, "read");
    if (blocked) return blocked;
    const db = await getDb();
    const rows = await db
      .select()
      .from(mediaItems)
      .orderBy(desc(mediaItems.updatedAt), desc(mediaItems.createdAt));
    return Response.json({ items: rows.map(toMediaItem) });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    const blocked = await guardApiRequest(request, "write");
    if (blocked) return blocked;
    const payload = await readJsonObject(request);
    const input = parseMediaPayload(payload);
    const db = await getDb();
    const [created] = await db
      .insert(mediaItems)
      .values({ id: crypto.randomUUID(), ...rowValues(input) })
      .returning();
    await recordAuditEvent(request, "media_created", created.id);
    return Response.json({ item: toMediaItem(created) }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}
