import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("offers owner-protected full and spreadsheet data exports", async () => {
  const [route, backup, controls] = await Promise.all([
    readFile(new URL("../app/api/export/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/data-export.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/data-export-actions.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(route, /guardApiRequest\(request, "read"\)/);
  assert.match(route, /content-disposition/);
  assert.match(backup, /schemaVersion: MEDIA_TRACKER_BACKUP_VERSION/);
  assert.match(backup, /items: MediaItem\[\]/);
  assert.match(backup, /collections: MediaCollection\[\]/);
  assert.match(backup, /Prevent provider-supplied titles or notes from becoming spreadsheet formulas/);
  assert.match(controls, /\/api\/export\?format=json/);
  assert.match(controls, /\/api\/export\?format=csv/);
});

test("keeps reminders, dialogs, and collection navigation accessible", async () => {
  const [tracker, reminderCenter, dialogFocus, styles] = await Promise.all([
    readFile(new URL("../app/components/media-tracker.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/reminder-center.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/hooks/use-dialog-focus.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(tracker, /aria-current=/);
  assert.match(tracker, /role="progressbar"/);
  assert.match(tracker, /metadataProvidersLoaded/);
  assert.match(reminderCenter, /aria-expanded=/);
  assert.match(reminderCenter, /items\.slice\(0, 8\)/);
  assert.match(dialogFocus, /previousFocus\.focus\(\)/);
  assert.match(dialogFocus, /event\.key !== "Tab"/);
  assert.match(styles, /\.side-nav \{[\s\S]*overflow-y: auto/);
  assert.doesNotMatch(styles, /@media \(max-width: 430px\) \{\s*\.reminder-button \{\s*display: none/);
});

test("surfaces newly added titles and library timestamps", async () => {
  const [tracker, styles] = await Promise.all([
    readFile(new URL("../app/components/media-tracker.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(tracker, /<h2>Newly added<\/h2>/);
  assert.match(tracker, /sortMode === "created_desc"/);
  assert.match(tracker, /<option value="created_desc">Recently added<\/option>/);
  assert.match(tracker, /Added to library/);
  assert.match(tracker, /Last modified/);
  assert.match(tracker, /Added \{formatLibraryTimestamp\(item\.createdAt\)\}/);
  assert.match(styles, /\.newly-added-grid/);
});
