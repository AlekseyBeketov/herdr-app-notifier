const NOTIFY_STATUSES = new Set(["blocked", "done"]);

/**
 * Return noteworthy status changes and a fresh snapshot for the next render.
 * First-seen agents are seeded silently so installing the mod does not replay
 * work that finished before it was enabled.
 */
export function collectTransitions(previous, agents, enabled) {
  const next = new Map();
  const events = [];

  for (const agent of agents) {
    const oldStatus = previous.get(agent.address);
    next.set(agent.address, agent.status);

    if (
      enabled &&
      oldStatus !== undefined &&
      oldStatus !== agent.status &&
      NOTIFY_STATUSES.has(agent.status) &&
      !agent.focused
    ) {
      events.push({ address: agent.address, status: agent.status, agent });
    }
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
