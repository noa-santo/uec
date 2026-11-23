import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_INBOX_LAYOUT, loadInboxLayout, saveInboxLayout } from "./ui_layout";

test("inbox layout remembers folder placement and pinned order", async () => {
  const expected = {
    ...DEFAULT_INBOX_LAYOUT,
    folderPlacement: "bottom" as const,
    pinnedItems: ["inbox:a@example.com", "folder:f1"],
  };
  await saveInboxLayout(expected);
  assert.deepEqual(await loadInboxLayout(), expected);
});
