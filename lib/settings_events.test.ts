import test from "node:test";
import assert from "node:assert/strict";
import { notifySettingsChanged, subscribeToSettings } from "./settings_events";

test("settings listeners are notified after a save and can unsubscribe", () => {
  let calls = 0;
  const listener = () => { calls++; };
  const unsubscribe = subscribeToSettings(listener);
  notifySettingsChanged();
  assert.equal(calls, 1);
  unsubscribe();
  notifySettingsChanged();
  assert.equal(calls, 1);
});
