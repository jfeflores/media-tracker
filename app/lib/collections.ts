import type { CollectionRow } from "@/db/schema";

export const COLLECTION_FILTER_KEYS = [
  "continue",
  "in_progress",
  "watchlist",
  "finished",
  "tierlist",
] as const;

export type CollectionFilterKey = (typeof COLLECTION_FILTER_KEYS)[number];
export type CollectionKind = "system" | "custom";

export type MediaCollection = {
  id: string;
  name: string;
  kind: CollectionKind;
  filterKey: CollectionFilterKey | null;
  sortOrder: number;
  mediaItemIds: string[];
  createdAt: string;
  updatedAt: string;
};

export function cleanCollectionName(value: unknown) {
  if (typeof value !== "string") return null;
  const name = value.replace(/\s+/g, " ").trim();
  return name ? name.slice(0, 60) : null;
}

export function toMediaCollection(row: CollectionRow, mediaItemIds: string[] = []): MediaCollection {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind === "system" ? "system" : "custom",
    filterKey: COLLECTION_FILTER_KEYS.includes(row.filterKey as CollectionFilterKey)
      ? row.filterKey as CollectionFilterKey
      : null,
    sortOrder: Number(row.sortOrder ?? 0),
    mediaItemIds: [...new Set(mediaItemIds.filter(Boolean))],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function sameCollectionName(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: "base" }) === 0;
}
