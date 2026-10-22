import { PEER_LOCAL_WORKSPACE, type PeerHubStatus } from "@t3tools/contracts";

/** Local coordination is a capability of the connected environment, independent of its Hub account. */
export function localCoordination(status: Pick<PeerHubStatus, "coordination">) {
  const { coordination } = status;
  const supported = coordination.local !== undefined;
  const available = coordination.local?.available === true;
  const sessions = coordination.sessions.filter((s) => s.workspace === PEER_LOCAL_WORKSPACE);
  const overlaps = coordination.overlaps
    .filter((o) => o.workspace === PEER_LOCAL_WORKSPACE)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return {
    supported,
    available,
    title: !supported
      ? "Local chats"
      : !available
        ? "Local coordination unavailable"
        : coordination.enabled
          ? "Peer Local"
          : "Peer Local · paused",
    description: !supported
      ? "Your chats work without a Hub account. Update this environment to use local agent coordination."
      : (coordination.local?.error ??
        "Agents in repositories opened on this environment coordinate here. Your local history stays on this environment."),
    sessions,
    overlaps,
    open: overlaps.filter((o) => o.state === "open").length,
    resolved: overlaps.filter((o) => o.state === "resolved").length,
    contexts: coordination.contexts.filter((c) => c.workspace === PEER_LOCAL_WORKSPACE),
    providers: [
      { name: "Claude Code", ready: coordination.enabled && coordination.claudeHooks },
      {
        name: "Codex",
        ready:
          coordination.enabled &&
          coordination.codexHooks === true &&
          coordination.codexHooksTrusted === true,
      },
    ],
  };
}
