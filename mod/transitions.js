const NOTIFY_STATUSES = new Set(["blocked", "done"]);

function notificationStatus(previousStatus, agent) {
  if (NOTIFY_STATUSES.has(agent.status)) return agent.status;
  // Herdr's Pi bridge reports `idle` at agent_settled instead of `done`.
  if (agent.app === "pi" && previousStatus === "working" && agent.status === "idle") {
    return "done";
  }
  return null;
}

/**
 * Return notification events, diagnostic decisions, and a fresh snapshot for
 * the next scan. First-seen agents are seeded silently so installing the mod
 * does not replay work that finished before it was enabled. A focused result
 * is deferred only while the Herdr window is active; otherwise it is queued.
 */
export function collectTransitions(previous, agents, enabled, windowActive = true) {
  const next = new Map();
  const events = [];
  const traces = [];

  for (const agent of agents) {
    const old = previous.get(agent.address);
    const looking = windowActive && agent.focused;
    let pending = old?.pending ?? null;

    if (!old) {
      traces.push({
        address: agent.address,
        action: "first_seen_seeded",
        to: agent.status,
        focused: agent.focused,
        windowActive,
        enabled,
      });
    } else if (!enabled) {
      if (old.status !== agent.status || pending !== null) {
        traces.push({
          address: agent.address,
          action: "disabled",
          from: old.status,
          to: agent.status,
          focused: agent.focused,
          windowActive,
          enabled,
        });
      }
      pending = null;
    } else if (old.status !== agent.status) {
      const status = notificationStatus(old.status, agent);
      if (status === agent.status && looking) {
        pending = status;
      } else {
        pending = null;
      }

      if (status && !looking) {
        events.push({ address: agent.address, status, agent });
        pending = null;
      }

      const action = !status
        ? "ignored"
        : !looking
          ? "queued"
          : status === agent.status
            ? "deferred_focused"
            : "suppressed_focused_completion";
      traces.push({
        address: agent.address,
        action,
        from: old.status,
        to: agent.status,
        notificationStatus: status,
        focused: agent.focused,
        windowActive,
        enabled,
        ...(!looking && status ? { reason: windowActive ? "agent_not_focused" : "window_inactive" } : {}),
      });
    } else if (pending === agent.status && !looking) {
      events.push({ address: agent.address, status: agent.status, agent });
      pending = null;
      traces.push({
        address: agent.address,
        action: "queued",
        from: old.status,
        to: agent.status,
        notificationStatus: agent.status,
        focused: agent.focused,
        windowActive,
        enabled,
        reason: windowActive ? "focus_released" : "window_inactive",
      });
    } else if (typeof old.seq === "number" && typeof agent.seq === "number" && agent.seq > old.seq) {
      traces.push({
        address: agent.address,
        action: "sequence_advanced_without_status_change",
        from: old.status,
        to: agent.status,
        focused: agent.focused,
        windowActive,
        enabled,
        previousSeq: old.seq,
        seq: agent.seq,
      });
    }

    next.set(agent.address, {
      status: agent.status,
      focused: agent.focused,
      seq: agent.seq,
      pending,
    });
  }

  return { next, events, traces };
}

export function notificationText(agent, status) {
  const name = agent.app || agent.program?.name || "Agent";
  const place = agent.space_name || agent.tab_name || "Herdr";
  return status === "blocked"
    ? { title: `Herdr — ${name} needs input`, body: place }
    : { title: `Herdr — ${name} finished`, body: place };
}
