import { asc } from "drizzle-orm";
import { guardApiRequest, readJsonObject } from "@/app/lib/api-security";
import { cleanCollectionName, sameCollectionName, toMediaCollection } from "@/app/lib/collections";
import { recordAuditEvent } from "@/app/lib/audit";
import { getD1Binding, getDb } from "@/db";
import { collections, mediaCollectionItems } from "@/db/schema";
import { routeError } from "../media/helpers";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const blocked = await guardApiRequest(request, "read");
    if (blocked) return blocked;
    const db = await getDb();
    const [rows, memberships] = await Promise.all([
      db.select().from(collections).orderBy(asc(collections.sortOrder), asc(collections.createdAt)),
      db.select({
        collectionId: mediaCollectionItems.collectionId,
        mediaItemId: mediaCollectionItems.mediaItemId,
      }).from(mediaCollectionItems),
    ]);
    const memberIds = new Map<string, string[]>();
    for (const membership of memberships) {
      const current = memberIds.get(membership.collectionId) ?? [];
      current.push(membership.mediaItemId);
      memberIds.set(membership.collectionId, current);
    }
    return Response.json(
      { collections: rows.map((row) => toMediaCollection(row, memberIds.get(row.id))) },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    const blocked = await guardApiRequest(request, "write");
    if (blocked) return blocked;
    const payload = await readJsonObject(request);
    const name = cleanCollectionName(payload.name);
    if (!name) return Response.json({ error: "Give the collection a name." }, { status: 400 });

    const db = await getDb();
    const current = await db.select().from(collections).orderBy(asc(collections.sortOrder));
    if (current.some((collection) => sameCollectionName(collection.name, name))) {
      return Response.json({ error: "A collection with that name already exists." }, { status: 409 });
    }
    const sortOrder = current.reduce((highest, collection) => Math.max(highest, collection.sortOrder), -1) + 1;
    const [created] = await db.insert(collections).values({
      id: crypto.randomUUID(),
      name,
      kind: "custom",
      filterKey: null,
      sortOrder,
    }).returning();
    await recordAuditEvent(request, "collection_created", created.id);
    return Response.json({ collection: toMediaCollection(created) }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const blocked = await guardApiRequest(request, "write");
    if (blocked) return blocked;
    const payload = await readJsonObject(request);
    const orderedIds = Array.isArray(payload.orderedIds)
      ? payload.orderedIds.filter((id): id is string => typeof id === "string")
        .map((id) => id.trim().slice(0, 100))
        .filter(Boolean)
      : [];
    if (!orderedIds.length || orderedIds.length > 100 || new Set(orderedIds).size !== orderedIds.length) {
      return Response.json({ error: "Provide each collection exactly once." }, { status: 400 });
    }

    const db = await getDb();
    const current = await db.select({ id: collections.id }).from(collections);
    const currentIds = new Set(current.map((collection) => collection.id));
    if (currentIds.size !== orderedIds.length || orderedIds.some((id) => !currentIds.has(id))) {
      return Response.json({ error: "The collection list changed. Refresh and try again." }, { status: 409 });
    }

    const d1 = await getD1Binding();
    const update = d1.prepare("UPDATE collections SET sort_order = ?, updated_at = ? WHERE id = ?");
    const updatedAt = new Date().toISOString();
    await d1.batch(orderedIds.map((id, index) => update.bind(index, updatedAt, id)));
    await recordAuditEvent(request, "collection_reordered", null);
    return Response.json({ orderedIds });
  } catch (error) {
    return routeError(error);
  }
}
