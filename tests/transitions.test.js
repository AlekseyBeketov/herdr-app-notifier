import test from "node:test";
import assert from "node:assert/strict";
import { collectTransitions, notificationText } from "../mod/transitions.js";

const agent = (overrides = {}) => ({
  address: "t1",
  status: "working",
  focused: false,
  app: "claude-code",
  space_name: "project",
  tab_name: "1",
  ...overrides,
});
const state = (status, focused = false, pending = null) => ({ status, focused, pending });

test("notifies on background working → done", () => {
  const result = collectTransitions(new Map([["t1", state("working")]]), [agent({ status: "done" })], true);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].status, "done");
  assert.equal(result.next.get("t1").status, "done");
  assert.equal(result.traces[0].action, "queued");
  assert.equal(result.traces[0].notificationStatus, "done");
});

test("notifies on background Pi working → idle as a completion", () => {
  const result = collectTransitions(
    new Map([["t1", state("working")]]),
    [agent({ app: "pi", status: "idle" })],
    true,
  );
  assert.deepEqual(result.events.map((event) => event.status), ["done"]);
  assert.equal(result.traces[0].action, "queued");
  assert.equal(result.traces[0].notificationStatus, "done");
});

test("does not treat other agents' working → idle as completion", () => {
  const result = collectTransitions(
    new Map([["t1", state("working")]]),
    [agent({ app: "claude-code", status: "idle" })],
    true,
  );
  assert.equal(result.events.length, 0);
  assert.equal(result.traces[0].action, "ignored");
});

test("does not notify for a focused Pi working → idle transition while the window is active", () => {
  const result = collectTransitions(
    new Map([["t1", state("working", true)]]),
    [agent({ app: "pi", status: "idle", focused: true })],
    true,
    true,
  );
  assert.equal(result.events.length, 0);
  assert.equal(result.next.get("t1").pending, null);
  assert.equal(result.traces[0].action, "suppressed_focused_completion");
  assert.equal(result.traces[0].notificationStatus, "done");
});

test("notifies for a focused agent when the Herdr window is inactive", () => {
  const result = collectTransitions(
    new Map([["t1", state("working", true)]]),
    [agent({ status: "done", focused: true })],
    true,
    false,
  );
  assert.deepEqual(result.events.map((event) => event.status), ["done"]);
  assert.equal(result.traces[0].action, "queued");
  assert.equal(result.traces[0].reason, "window_inactive");
});

test("releases a deferred completion when the Herdr window becomes inactive", () => {
  const first = collectTransitions(
    new Map([["t1", state("working", true)]]),
    [agent({ status: "done", focused: true })],
    true,
    true,
  );
  const second = collectTransitions(first.next, [agent({ status: "done", focused: true })], true, false);
  assert.equal(first.events.length, 0);
  assert.deepEqual(second.events.map((event) => event.status), ["done"]);
  assert.equal(second.traces[0].reason, "window_inactive");
});

test("notifies for a focused Pi completion when the Herdr window is inactive", () => {
  const result = collectTransitions(
    new Map([["t1", state("working", true)]]),
    [agent({ app: "pi", status: "idle", focused: true })],
    true,
    false,
  );
  assert.deepEqual(result.events.map((event) => event.status), ["done"]);
  assert.equal(result.traces[0].reason, "window_inactive");
});

test("notifies on background working → blocked", () => {
  const result = collectTransitions(new Map([["t1", state("working")]]), [agent({ status: "blocked" })], true);
  assert.deepEqual(result.events.map((event) => event.status), ["blocked"]);
});

test("silently seeds agents first seen after installation", () => {
  const result = collectTransitions(new Map(), [agent({ status: "blocked" })], true);
  assert.equal(result.events.length, 0);
  assert.equal(result.next.get("t1").status, "blocked");
  assert.equal(result.traces[0].action, "first_seen_seeded");
});

test("does not notify when the agent is focused", () => {
  const result = collectTransitions(new Map([["t1", state("working", true)]]), [agent({ status: "done", focused: true })], true);
  assert.equal(result.events.length, 0);
  assert.equal(result.next.get("t1").pending, "done");
});

test("defers a focused completion until the agent leaves focus", () => {
  const first = collectTransitions(new Map([["t1", state("working", true)]]), [agent({ status: "done", focused: true })], true);
  const second = collectTransitions(first.next, [agent({ status: "done", focused: false })], true);
  assert.equal(first.events.length, 0);
  assert.equal(second.events.length, 1);
  assert.equal(second.events[0].status, "done");
  assert.equal(first.traces[0].action, "deferred_focused");
  assert.equal(second.traces[0].reason, "focus_released");
});

test("clears a pending completion when it becomes idle", () => {
  const first = collectTransitions(new Map([["t1", state("working", true)]]), [agent({ status: "done", focused: true })], true);
  const second = collectTransitions(first.next, [agent({ status: "idle", focused: false })], true);
  assert.equal(second.events.length, 0);
  assert.equal(second.next.get("t1").pending, null);
});

test("does not repeat a notification after focus changes", () => {
  const first = collectTransitions(new Map([["t1", state("working")]]), [agent({ status: "done" })], true);
  const focused = collectTransitions(first.next, [agent({ status: "done", focused: true })], true);
  const background = collectTransitions(focused.next, [agent({ status: "done" })], true);
  assert.equal(first.events.length, 1);
  assert.equal(focused.events.length, 0);
  assert.equal(background.events.length, 0);
});

test("does not release a pending alert while disabled", () => {
  const first = collectTransitions(new Map([["t1", state("working", true)]]), [agent({ status: "done", focused: true })], true);
  const disabled = collectTransitions(first.next, [agent({ status: "done" })], false);
  const enabled = collectTransitions(disabled.next, [agent({ status: "done" })], true);
  assert.equal(disabled.events.length, 0);
  assert.equal(enabled.events.length, 0);
  assert.equal(disabled.next.get("t1").pending, null);
});

test("does not notify while disabled, but updates the snapshot", () => {
  const result = collectTransitions(new Map([["t1", state("working")]]), [agent({ status: "done" })], false);
  assert.equal(result.events.length, 0);
  assert.equal(result.next.get("t1").status, "done");
  assert.equal(result.traces[0].action, "disabled");
});

test("ignores unchanged and non-notification statuses", () => {
  const previous = new Map([["t1", state("working")], ["t2", state("idle")]]);
  const result = collectTransitions(previous, [agent(), agent({ address: "t2", status: "working" })], true);
  assert.equal(result.events.length, 0);
  assert.equal(result.traces.length, 1);
  assert.equal(result.traces[0].action, "ignored");
});

test("traces a changed Herdr sequence when the sampled status is unchanged", () => {
  const previous = new Map([["t1", { ...state("idle"), seq: 10 }]]);
  const result = collectTransitions(previous, [agent({ status: "idle", seq: 12 })], true, false);
  assert.equal(result.events.length, 0);
  assert.equal(result.traces[0].action, "sequence_advanced_without_status_change");
  assert.equal(result.traces[0].previousSeq, 10);
  assert.equal(result.traces[0].seq, 12);
});

test("does not re-notify the same status on subsequent renders", () => {
  const first = collectTransitions(new Map([["t1", state("working")]]), [agent({ status: "done" })], true);
  const second = collectTransitions(first.next, [agent({ status: "done" })], true);
  assert.equal(first.events.length, 1);
  assert.equal(second.events.length, 0);
});

test("uses generic text and does not include terminal output", () => {
  assert.deepEqual(notificationText(agent({ status: "blocked" }), "blocked"), {
    title: "Herdr — claude-code needs input",
    body: "project",
  });
  assert.deepEqual(notificationText(agent({ app: null, space_name: "" }), "done"), {
    title: "Herdr — Agent finished",
    body: "1",
  });
});
