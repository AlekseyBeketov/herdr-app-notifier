import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, appHome, closeOverlay, exec, layout, props, run, theme } from "herdr";
import { collectTransitions, notificationText } from "./transitions.js";

const MOD_ID = "herdr-app-notifier";
const HELPER_RELATIVE = `/mods/${MOD_ID}/HerdrNotifier.app/Contents/MacOS/HerdrNotifier`;

function helperPath() {
  return `${appHome()}${HELPER_RELATIVE}`;
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
      pending: null,
    }]));
    this.queue = [];
    this.sending = false;
    cx.timer.every(1000, (cx) => this.scanAgents(cx));
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    localStorage.setItem("enabled", String(enabled));
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
          if (!this.enabled) continue;

          const message = notificationText(event.agent, event.status);
          try {
            const result = await submitNotification(
              "--notify",
              message.title,
              message.body,
              `${event.address}-${event.status}-${Date.now()}`,
            );
            if (result.code !== 0) {
              this.note = result.stderr.trim() || "The native helper could not submit a notification.";
            }
          } catch (error) {
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
    const snapshot = collectTransitions(this.previous, agents(), this.enabled);
    this.previous = snapshot.next;
    this.enqueue(snapshot.events, cx);
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
