import { and, eq, inArray } from "drizzle-orm";
import { guardApiRequest, readJsonObject } from "@/app/lib/api-security";
import { recordAuditEvent } from "@/app/lib/audit";
import { getD1Binding, getDb } from "@/db";
import { collections, mediaItems } from "@/db/schema";
import { routeError } from "@/app/api/media/helpers";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: Context) {
  try {
    const blocked = await guardApiRequest(request, "write");
    if (blocked) return blocked;
    const { id } = await context.params;
    const payload = await readJsonObject(request);
    const collectionIds = Array.isArray(payload.collectionIds)
      ? [...new Set(payload.collectionIds.filter((value): value is string => typeof value === "string")
        .map((value) => value.trim().slice(0, 100))
        .filter(Boolean))]
      : [];
    if (collectionIds.length > 100) {
      return Response.json({ error: "Too many collections were selected." }, { status: 400 });
    }

    const db = await getDb();
    const [media] = await db.select({ id: mediaItems.id }).from(mediaItems).where(eq(mediaItems.id, id)).limit(1);
    if (!media) return Response.json({ error: "Media item not found." }, { status: 404 });

    if (collectionIds.length) {
      const validCollections = await db.select({ id: collections.id }).from(collections).where(and(
        inArray(collections.id, collectionIds),
        eq(collections.kind, "custom"),
      ));
      if (validCollections.length !== collectionIds.length) {
        return Response.json({ error: "One of those collections is unavailable." }, { status: 409 });
      }
    }

    const d1 = await getD1Binding();
    const remove = d1.prepare("DELETE FROM media_collection_items WHERE media_item_id = ?").bind(id);
    const insert = d1.prepare(
      "INSERT INTO media_collection_items (collection_id, media_item_id) VALUES (?, ?)",
    );
    await d1.batch([
      remove,
      ...collectionIds.map((collectionId) => insert.bind(collectionId, id)),
    ]);
    await recordAuditEvent(request, "collection_membership_updated", id);
    return Response.json({ collectionIds });
  } catch (error) {
    return routeError(error);
  }
}
