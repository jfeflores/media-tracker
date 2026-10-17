import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readdir, readFile } from "node:fs/promises";
import { getTableColumns } from "drizzle-orm";
import { __initializeMediaSchemaForTests } from "../db/index.ts";
import * as schema from "../db/schema.ts";

// Execute the actual SQL using SQLite; this adapter supplies D1's small async surface.
function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  const d1 = {
    prepare(sql) {
      const statement = (params = []) => ({
        bind(...values) { return statement(values); },
        async all() { return { results: sqlite.prepare(sql).all(...params) }; },
        async first() { return sqlite.prepare(sql).get(...params) ?? null; },
        async run() { return sqlite.prepare(sql).run(...params); },
      });
      return statement();
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const result = [];
        for (const statement of statements) result.push(await statement.run());
        sqlite.exec("COMMIT");
        return result;
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  return { sqlite, d1 };
}

function checkSchema(sqlite) {
  for (const [table, name] of [[schema.mediaItems, "media_items"], [schema.collections, "collections"],
    [schema.mediaCollectionItems, "media_collection_items"], [schema.auditEvents, "audit_events"],
    [schema.requestLimits, "request_limits"], [schema.metadataProviderHealth, "metadata_provider_health"]]) {
    const expected = Object.values(getTableColumns(table)).map((column) => column.name).sort();
    const actual = sqlite.prepare(`PRAGMA table_info(${name})`).all().map((column) => column.name).sort();
    assert.deepEqual(actual, expected, `${name} must match the application schema`);
  }
}

test("fresh runtime setup creates an empty personal library and is safe to rerun", async () => {
  const { sqlite, d1 } = database();
  try {
    await __initializeMediaSchemaForTests(d1);
    checkSchema(sqlite);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM media_items").get().n, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM collections WHERE kind='system'").get().n, 5);
    sqlite.prepare("INSERT INTO media_items (id,title,type,notes) VALUES (?,?,?,?)").run("sample", "Fictional Series", "tv", "Private note");
    sqlite.prepare("UPDATE collections SET sort_order=99 WHERE id='system-finished'").run();
    await __initializeMediaSchemaForTests(d1);
    assert.equal(sqlite.prepare("SELECT notes FROM media_items WHERE id='sample'").get().notes, "Private note");
    assert.equal(sqlite.prepare("SELECT sort_order FROM collections WHERE id='system-finished'").get().sort_order, 99);
    assert.equal(sqlite.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  } finally { sqlite.close(); }
});

test("the complete migration chain creates the same schema without importing personal data", async () => {
  const { sqlite, d1 } = database();
  try {
    const directory = new URL("../drizzle/", import.meta.url);
    const files = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
    for (const file of files) sqlite.exec(await readFile(new URL(file, directory), "utf8"));
    checkSchema(sqlite);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM media_items").get().n, 0);
    await __initializeMediaSchemaForTests(d1);
    checkSchema(sqlite);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM media_items").get().n, 0);
    assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { sqlite.close(); }
});

test("deleting a media item or collection cascades only its membership", async () => {
  const { sqlite, d1 } = database();
  try {
    await __initializeMediaSchemaForTests(d1);
    sqlite.exec("INSERT INTO media_items (id,title,type) VALUES ('one','Sample One','tv'),('two','Sample Two','game')");
    sqlite.exec("INSERT INTO collections (id,name) VALUES ('custom','Sample Collection')");
    sqlite.exec("INSERT INTO media_collection_items (collection_id,media_item_id) VALUES ('custom','one'),('custom','two')");
    sqlite.exec("DELETE FROM media_items WHERE id='one'");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM media_collection_items").get().n, 1);
    sqlite.exec("DELETE FROM collections WHERE id='custom'");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM media_collection_items").get().n, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM media_items").get().n, 1);
  } finally { sqlite.close(); }
});
