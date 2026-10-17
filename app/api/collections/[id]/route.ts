import { eq } from "drizzle-orm";
import { guardApiRequest, readJsonObject } from "@/app/lib/api-security";
import { cleanCollectionName, sameCollectionName, toMediaCollection } from "@/app/lib/collections";
import { recordAuditEvent } from "@/app/lib/audit";
import { getDb } from "@/db";
import { collections } from "@/db/schema";
import { routeError } from "@/app/api/media/helpers";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const blocked = await guardApiRequest(request, "write");
    if (blocked) return blocked;
    const { id } = await context.params;
    const payload = await readJsonObject(request);
    const name = cleanCollectionName(payload.name);
    if (!name) return Response.json({ error: "Give the collection a name." }, { status: 400 });

    const db = await getDb();
    const [existing] = await db.select().from(collections).where(eq(collections.id, id)).limit(1);
    if (!existing) return Response.json({ error: "Collection not found." }, { status: 404 });
    if (existing.kind !== "custom") {
      return Response.json({ error: "Built-in collection names stay fixed." }, { status: 400 });
    }
    const allCollections = await db.select({ id: collections.id, name: collections.name }).from(collections);
    if (allCollections.some((collection) => collection.id !== id && sameCollectionName(collection.name, name))) {
      return Response.json({ error: "A collection with that name already exists." }, { status: 409 });
    }

    const [updated] = await db.update(collections)
      .set({ name, updatedAt: new Date().toISOString() })
      .where(eq(collections.id, id))
      .returning();
    await recordAuditEvent(request, "collection_updated", id);
    return Response.json({ collection: toMediaCollection(updated) });
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
    const [existing] = await db.select().from(collections).where(eq(collections.id, id)).limit(1);
    if (!existing) return Response.json({ error: "Collection not found." }, { status: 404 });
    if (existing.kind !== "custom") {
      return Response.json({ error: "Built-in collections cannot be removed." }, { status: 400 });
    }
    await db.delete(collections).where(eq(collections.id, id));
    await recordAuditEvent(request, "collection_deleted", id);
    return Response.json({ deleted: true });
  } catch (error) {
    return routeError(error);
  }
}
