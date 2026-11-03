import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, appHome, closeOverlay, exec, layout, props, run, theme, window as appWindow } from "herdr";
import { collectTransitions, notificationText } from "./transitions.js";

const MOD_ID = "herdr-app-notifier";
const HELPER_RELATIVE = `/mods/${MOD_ID}/HerdrNotifier.app/Contents/MacOS/HerdrNotifier`;
const LOGGER_PATH = "/usr/bin/logger";
const HEARTBEAT_INTERVAL_MS = 60_000;

let diagnosticWrites = Promise.resolve();

function logDiagnostic(event, fields = {}) {
  const message = JSON.stringify({
    component: MOD_ID,
    ...fields,
    timestamp: new Date().toISOString(),
    event,
  });

  diagnosticWrites = diagnosticWrites
    .then(async () => {
      const result = await exec(LOGGER_PATH, ["-t", MOD_ID, message]);
      if (result.code !== 0) {
        throw new Error(result.stderr.trim() || `logger exited with code ${result.code}`);
      }
    })
    .catch((error) => {
      console.error(`[${MOD_ID}] diagnostic log failed: ${String(error)}`);
    });
  return diagnosticWrites;
}

function diagnosticError(error, sensitiveValues = []) {
  let summary = String(error);
  for (const value of sensitiveValues) {
    if (typeof value === "string" && value.length > 0) {
      summary = summary.replaceAll(value, "[redacted]");
    }
  }
  return summary.slice(0, 300);
}

function helperPath() {
  return `${appHome()}${HELPER_RELATIVE}`;
}

function herdrWindowIsActive() {
  // herdr.window() is published by the app's poll/render pass. Read GPUI's
  // native focus in this task instead, so a blur cannot suppress a completion.
  return globalThis.window.is_window_active();
}

function findNotifierBlocks(node, ids = []) {
  if (!node || typeof node !== "object") return ids;
  if (
    node.type === "block" &&
    node.content?.mod === MOD_ID &&
    typeof node.id === "string"
  ) {
    ids.push(node.id);
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) findNotifierBlocks(child, ids);
  }
  return ids;
}

function submitNotification(mode, title, body, identifier) {
  const args = [mode, "--title", title, "--body", body];
  if (identifier) args.push("--identifier", identifier);
  return exec(helperPath(), args);
}

function actionButton(label, onClick, t) {
  return div()
    .px(12)
    .py(8)
    .rounded(6)
    .bg(t.selected)
    .text_color(t.foreground)
    .cursor_pointer()
    .on_click(onClick)
    .child(label);
}

export default class NativeNotifications extends View {
  init(_props, cx) {
    this.enabled = localStorage.getItem("enabled") === "true";
    this.note = "macOS sender: Herdr App Notifier.";
    this.previous = new Map(agents().map((agent) => [agent.address, {
      status: agent.status,
      focused: agent.focused,
      seq: agent.seq,
      pending: null,
    }]));
    this.queue = [];
    this.sending = false;
    this.lastScanAt = Date.now();
    this.lastHeartbeatAt = this.lastScanAt;
    this.maxScanGapMs = 0;
    this.scansSinceHeartbeat = 0;
    logDiagnostic("monitor_started", {
      enabled: this.enabled,
      windowActive: herdrWindowIsActive(),
      initialAgentCount: this.previous.size,
      pollIntervalMs: 1000,
    });
    cx.timer.every(1000, (cx) => this.scanAgents(cx));
  }

  setEnabled(enabled) {
    const changed = this.enabled !== enabled;
    this.enabled = enabled;
    localStorage.setItem("enabled", String(enabled));
    if (changed) logDiagnostic("enabled_changed", { enabled });
  }

  enableAndTest(cx) {
    cx.spawn(async (cx) => {
      this.note = "Sending a test notification…";
      cx.notify();
      try {
        const result = await submitNotification(
          "--test",
          "Herdr — notifications enabled",
          "Native macOS notification test from Herdr App Notifier.",
        );
        if (result.code === 0) {
          this.setEnabled(true);
          this.note = "Enabled. If no banner appears, allow Herdr App Notifier in System Settings → Notifications.";
        } else {
          this.note = result.stderr.trim() || "The native helper could not submit the test notification.";
        }
      } catch (error) {
        this.note = `Could not start the native helper: ${String(error)}`;
      }
      cx.notify();
    });
  }

  hidePanel(cx) {
    const ids = findNotifierBlocks(layout());
    if (ids.length === 0) {
      this.note = "No notifier block found in this layout; keep a layout copy running for notifications.";
      cx.notify();
      return;
    }

    for (const id of ids) run("layout.hide", { id });
    const overlayId = props()?.overlay;
    if (typeof overlayId === "string") closeOverlay(overlayId);
  }

  sendTest(cx) {
    cx.spawn(async (cx) => {
      this.note = "Sending test notification…";
      cx.notify();
      try {
        const result = await submitNotification(
          "--test",
          "Herdr — notification test",
          "Native Notification Center test from Herdr App Notifier.",
        );
        this.note = result.code === 0
          ? "Test submitted. Sender: Herdr App Notifier."
          : result.stderr.trim() || "The native helper could not submit the test notification.";
      } catch (error) {
        this.note = `Could not start the native helper: ${String(error)}`;
      }
      cx.notify();
    });
  }

  enqueue(events, cx) {
    this.queue.push(...events);
    if (this.sending || this.queue.length === 0) return;

    this.sending = true;
    cx.spawn(async (cx) => {
      try {
        while (this.queue.length > 0) {
          const event = this.queue.shift();
          const app = event.agent.app || event.agent.program?.name || null;
          if (!this.enabled) {
            await logDiagnostic("notification_skipped", {
              address: event.address,
              app,
              notificationStatus: event.status,
              reason: "disabled_before_dispatch",
            });
            continue;
          }

          const message = notificationText(event.agent, event.status);
          const identifier = `${event.address}-${event.status}-${Date.now()}`;
          const startedAt = Date.now();
          await logDiagnostic("notification_helper_start", {
            address: event.address,
            app,
            observedStatus: event.agent.status,
            notificationStatus: event.status,
            identifier,
          });
          try {
            const result = await submitNotification(
              "--notify",
              message.title,
              message.body,
              identifier,
            );
            await logDiagnostic("notification_helper_exit", {
              address: event.address,
              app,
              notificationStatus: event.status,
              identifier,
              exitCode: result.code,
              durationMs: Date.now() - startedAt,
              ...(result.code === 0
                ? {}
                : { stderr: diagnosticError(result.stderr, [message.title, message.body]) }),
            });
            if (result.code !== 0) {
              this.note = result.stderr.trim() || "The native helper could not submit a notification.";
            }
          } catch (error) {
            await logDiagnostic("notification_helper_error", {
              address: event.address,
              app,
              notificationStatus: event.status,
              identifier,
              durationMs: Date.now() - startedAt,
              error: diagnosticError(error, [message.title, message.body]),
            });
            this.note = `Could not start the native helper: ${String(error)}`;
          }
        }
      } finally {
        this.sending = false;
        cx.notify();
      }
    });
  }

  scanAgents(cx) {
    const scanAt = Date.now();
    const scanGapMs = scanAt - this.lastScanAt;
    this.lastScanAt = scanAt;
    this.maxScanGapMs = Math.max(this.maxScanGapMs, scanGapMs);
    this.scansSinceHeartbeat += 1;
    const currentAgents = agents();
    const windowActive = herdrWindowIsActive();
    const snapshot = collectTransitions(this.previous, currentAgents, this.enabled, windowActive);
    const agentsByAddress = new Map(currentAgents.map((agent) => [agent.address, agent]));

    for (const trace of snapshot.traces) {
      const agent = agentsByAddress.get(trace.address);
      logDiagnostic(
        trace.action === "first_seen_seeded" ? "agent_first_seen" : "agent_transition_decision",
        {
          ...trace,
          seq: agent?.seq ?? null,
          previousSeq: this.previous.get(trace.address)?.seq ?? null,
          scanGapMs,
          app: agent?.app || agent?.program?.name || null,
        },
      );
    }

    this.previous = snapshot.next;
    this.enqueue(snapshot.events, cx);

    const now = Date.now();
    if (now - this.lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
      this.lastHeartbeatAt = now;
      logDiagnostic("monitor_heartbeat", {
        enabled: this.enabled,
        windowActive,
        snapshotWindowActive: appWindow()?.active === true,
        agentCount: currentAgents.length,
        scansSinceHeartbeat: this.scansSinceHeartbeat,
        maxScanGapMs: this.maxScanGapMs,
      });
      this.scansSinceHeartbeat = 0;
      this.maxScanGapMs = 0;
    }
  }

  render(cx) {
    const t = theme();

    return v_flex()
      .size_full()
      .p(16)
      .gap(12)
      .bg(t.surface)
      .child(div().text_size(16).font_semibold().text_color(t.foreground).child("Native notifications"))
      .child(
        div()
          .text_size(12)
          .line_height("18px")
          .text_color(t.muted)
          .child("Send native alerts for background agents. After setup, hide this panel; its hidden layout block keeps monitoring."),
      )
      .child(
        h_flex()
          .items_center()
          .gap(8)
          .child(div().size(8).rounded(4).bg(this.enabled ? t.done : t.dim))
          .child(div().text_size(12).text_color(t.foreground).child(this.enabled ? "Enabled" : "Disabled")),
      )
      .child(
        actionButton(
          this.enabled ? "Disable notifications" : "Enable and test",
          (_event, nextCx) => {
            if (this.enabled) {
              this.setEnabled(false);
              this.note = "Disabled. macOS notification permission remains unchanged.";
              nextCx.notify();
            } else {
              this.enableAndTest(nextCx);
            }
          },
          t,
        ),
      )
      .when(this.enabled, (el) =>
        el.child(actionButton("Send test", (_event, nextCx) => this.sendTest(nextCx), t)),
      )
      .child(actionButton("Hide panel (keep notifications)", (_event, nextCx) => this.hidePanel(nextCx), t))
      .child(div().text_size(11).line_height("16px").text_color(t.dim).child(this.note));
  }
}
