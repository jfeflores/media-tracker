import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { mediaItems } from "@/db/schema";
import { guardApiRequest, readJsonObject } from "@/app/lib/api-security";
import { MEDIA_TIERS, type MediaTier } from "@/app/lib/media";
import { parseMediaPayload, routeError, rowValues, toMediaItem } from "../helpers";
import { recordAuditEvent } from "@/app/lib/audit";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const blocked = await guardApiRequest(request, "read");
    if (blocked) return blocked;
    const { id } = await context.params;
    const db = await getDb();
    const [row] = await db.select().from(mediaItems).where(eq(mediaItems.id, id)).limit(1);
    if (!row) return Response.json({ error: "Media item not found." }, { status: 404 });
    return Response.json({ item: toMediaItem(row) });
  } catch (error) {
    return routeError(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const blocked = await guardApiRequest(request, "write");
    if (blocked) return blocked;
    const { id } = await context.params;
    const payload = await readJsonObject(request);
    const db = await getDb();
    const isTierOnlyUpdate = Object.keys(payload).length === 1 && "tier" in payload;
    if (isTierOnlyUpdate && !MEDIA_TIERS.includes(payload.tier as MediaTier)) {
      return Response.json({ error: "Choose a valid tier." }, { status: 400 });
    }
    const values = isTierOnlyUpdate
      ? { tier: payload.tier as MediaTier }
      : rowValues(parseMediaPayload(payload));
    const [updated] = await db
      .update(mediaItems)
      .set({
        ...values,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(mediaItems.id, id))
      .returning();
    if (!updated) return Response.json({ error: "Media item not found." }, { status: 404 });
    await recordAuditEvent(request, "media_updated", updated.id);
    return Response.json({ item: toMediaItem(updated) });
  } catch (error) {
    return routeError(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const blocked = await guardApiRequest(request, "write", { requiresJson: false });
    if (blocked) return blocked;
    const { id } = await context.params;
    const db = await getDb();
    const [deleted] = await db
      .delete(mediaItems)
      .where(eq(mediaItems.id, id))
      .returning({ id: mediaItems.id });
    if (!deleted) return Response.json({ error: "Media item not found." }, { status: 404 });
    await recordAuditEvent(request, "media_deleted", deleted.id);
    return Response.json({ deleted: true });
  } catch (error) {
    return routeError(error);
  }
}
