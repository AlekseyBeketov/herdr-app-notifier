import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { collectTransitions, notificationText } from "../mod/transitions.js";

// Run the real View methods with Herdr's host boundary supplied by the test.
// In particular, the app snapshot can still say active after native focus left.
async function monitor() {
  const source = (await readFile(new URL("../mod/main.js", import.meta.url), "utf8"))
    .replace(/^import .*;\n/gm, "")
    .replace("export default class", "class");
  const notifications = [];
  const tasks = [];
  let nativeActive = false;
  let snapshotActive = true;
  let status = "working";
  const agent = { address: "t1", app: "codex", status: "working", focused: true, seq: 1 };
  const context = {
    View: class {}, Date, console, collectTransitions, notificationText,
    localStorage: { getItem: () => "true", setItem() {} },
    appHome: () => "/test", agents: () => [{ ...agent, status }],
    appWindow: () => ({ active: snapshotActive }),
    // gpui-shell exposes the native window on the global object.
    globalThis: { window: { is_window_active: () => nativeActive } },
    exec: async (path, args) => {
      if (path !== "/usr/bin/logger") notifications.push(args);
      return { code: 0, stdout: "", stderr: "" };
    },
  };
  const Mod = vm.runInNewContext(`${source}\nNativeNotifications`, context);
  const view = new Mod();
  const cx = { timer: { every() {} }, notify() {}, spawn(fn) { tasks.push(fn(cx)); } };
  view.init({}, cx);
  return {
    view, cx, notifications,
    setStatus(value) { status = value; },
    setActive(value) { nativeActive = value; snapshotActive = value; },
    async scan() {
      await view.scanAgents(cx);
      await Promise.all(tasks);
    },
  };
}

test("dispatches completion outside Herdr even when the app focus snapshot is stale", async () => {
  const m = await monitor();
  m.setStatus("done");
  await m.scan();
  assert.equal(m.notifications.length, 1, "notification must arrive before returning to Herdr");
});

test("keeps a focused completion quiet while the native window is active", async () => {
  const m = await monitor();
  m.setActive(true);
  m.setStatus("done");
  await m.scan();
  assert.equal(m.notifications.length, 0);
  m.setActive(false);
  await m.scan();
  assert.equal(m.notifications.length, 1);
  await m.scan();
  assert.equal(m.notifications.length, 1);
});

test("dispatches an input request outside Herdr with a stale focus snapshot", async () => {
  const m = await monitor();
  m.setStatus("blocked");
  await m.scan();
  assert.equal(m.notifications.length, 1);
  assert.equal(m.notifications[0][0], "--notify");
});

test("does not dispatch outside Herdr when notifications are disabled", async () => {
  const m = await monitor();
  m.view.setEnabled(false);
  m.setStatus("done");
  await m.scan();
  assert.equal(m.notifications.length, 0);
});
