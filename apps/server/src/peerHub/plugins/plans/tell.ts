import type { PeerSessionView } from "../../core/plugin.ts";

/** What the plugin keeps of one session while it runs: whether it declared a plan, and heard the plan-mode line. */
interface Memory {
  declared: boolean;
  nudged: boolean;
  /** Told keys, where core keeps none. */
  readonly told: Set<string>;
}

export const memory = (session: PeerSessionView) =>
  session.local<Memory>("plans", () => ({ declared: false, nudged: false, told: new Set() }));

/** What the session was told of relations: core keeps it across Peer's restarts, until the context is compacted. */
export const toldOf = (session: PeerSessionView) => session.told?.("plans") ?? memory(session).told;
