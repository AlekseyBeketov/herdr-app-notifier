const NOTIFY_STATUSES = new Set(["blocked", "done"]);

/**
 * Return noteworthy status changes and a fresh snapshot for the next render.
 * First-seen agents are seeded silently so installing the mod does not replay
 * work that finished before it was enabled. Focused done/blocked states stay
 * pending until the agent leaves focus, unless it returns to idle first.
 */
export function collectTransitions(previous, agents, enabled) {
  const next = new Map();
  const events = [];

  for (const agent of agents) {
    const old = previous.get(agent.address);
    let pending = old?.pending ?? null;

    if (old) {
      if (!enabled) {
        pending = null;
      } else if (old.status !== agent.status) {
        pending = NOTIFY_STATUSES.has(agent.status) && agent.focused ? agent.status : null;
        if (NOTIFY_STATUSES.has(agent.status) && !agent.focused) {
          events.push({ address: agent.address, status: agent.status, agent });
          pending = null;
        }
      } else if (pending === agent.status && !agent.focused) {
        events.push({ address: agent.address, status: agent.status, agent });
        pending = null;
      }
    }

    next.set(agent.address, {
      status: agent.status,
      focused: agent.focused,
      pending,
    });
  }

  return { next, events };
}

export function notificationText(agent, status) {
  const name = agent.app || agent.program?.name || "Agent";
  const place = agent.space_name || agent.tab_name || "Herdr";
  return status === "blocked"
    ? { title: `Herdr — ${name} needs input`, body: place }
    : { title: `Herdr — ${name} finished`, body: place };
}
