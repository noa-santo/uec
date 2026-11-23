import test from "node:test";
import assert from "node:assert/strict";
import { getItem, isQuotaError, onStorageQuotaExceeded, setItem } from "./storage";

test("quota errors are detected", () => {
  const error = new Error("Quota exceeded");
  error.name = "QuotaExceededError";
  assert.equal(isQuotaError(error), true);
  assert.equal(isQuotaError(new Error("network down")), false);
});

test("a full storage reports failure instead of throwing", async () => {
  (global as any).__quotaFail = true;
  try {
    const result = await setItem("lib.storage.test.fail", "value", false);
    assert.equal(result.ok, false);
    assert.match(String(result.error), /Quota/i);
    // The value remains usable for this session.
    assert.equal(await getItem("lib.storage.test.fail", false), "value");
  } finally {
    (global as any).__quotaFail = false;
  }
});

test("a quota retry succeeds after a recovery handler frees space", async () => {
  onStorageQuotaExceeded(async () => { (global as any).__quotaFail = false; });
  (global as any).__quotaFail = true;
  const result = await setItem("lib.storage.test.recovered", "value", false);
  assert.equal(result.ok, true);
  assert.equal(await getItem("lib.storage.test.recovered", false), "value");
});
