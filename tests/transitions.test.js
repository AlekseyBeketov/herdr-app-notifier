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

test("notifies on background working → done", () => {
  const result = collectTransitions(new Map([["t1", "working"]]), [agent({ status: "done" })], true);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].status, "done");
  assert.equal(result.next.get("t1"), "done");
});

test("notifies on background working → blocked", () => {
  const result = collectTransitions(new Map([["t1", "working"]]), [agent({ status: "blocked" })], true);
  assert.deepEqual(result.events.map((event) => event.status), ["blocked"]);
});

test("silently seeds agents first seen after installation", () => {
  const result = collectTransitions(new Map(), [agent({ status: "blocked" })], true);
  assert.equal(result.events.length, 0);
  assert.equal(result.next.get("t1"), "blocked");
});

test("does not notify when the agent is focused", () => {
  const result = collectTransitions(new Map([["t1", "working"]]), [agent({ status: "done", focused: true })], true);
  assert.equal(result.events.length, 0);
});

test("does not notify while disabled, but updates the snapshot", () => {
  const result = collectTransitions(new Map([["t1", "working"]]), [agent({ status: "done" })], false);
  assert.equal(result.events.length, 0);
  assert.equal(result.next.get("t1"), "done");
});

test("ignores unchanged and non-notification statuses", () => {
  const previous = new Map([["t1", "working"], ["t2", "idle"]]);
  const result = collectTransitions(previous, [agent(), agent({ address: "t2", status: "working" })], true);
  assert.equal(result.events.length, 0);
});

test("does not re-notify the same status on subsequent renders", () => {
  const first = collectTransitions(new Map([["t1", "working"]]), [agent({ status: "done" })], true);
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
