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
});

test("notifies on background working → blocked", () => {
  const result = collectTransitions(new Map([["t1", state("working")]]), [agent({ status: "blocked" })], true);
  assert.deepEqual(result.events.map((event) => event.status), ["blocked"]);
});

test("silently seeds agents first seen after installation", () => {
  const result = collectTransitions(new Map(), [agent({ status: "blocked" })], true);
  assert.equal(result.events.length, 0);
  assert.equal(result.next.get("t1").status, "blocked");
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
});

test("ignores unchanged and non-notification statuses", () => {
  const previous = new Map([["t1", state("working")], ["t2", state("idle")]]);
  const result = collectTransitions(previous, [agent(), agent({ address: "t2", status: "working" })], true);
  assert.equal(result.events.length, 0);
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
