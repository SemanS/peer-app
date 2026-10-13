/**
 * What Plans says in Settings on the web: its row's summary and state line. Pure, so the row only
 * draws it. What a task's page shows (the section, its relations, the count) is the client
 * runtime's, shared with the phone: `peer/plans-view`.
 */
import { agoInWords } from "@t3tools/client-runtime/peer/work";
import type { PeerPlansStatus, PeerPluginState } from "@t3tools/contracts";

/** What the plugin does, as Settings says it under the title. */
export const PLANS_SUMMARY =
  "Before editing, agents say what they will change, use and provide; Peer says whose work meets theirs.";

const INACTIVE_LINE =
  "While it is inactive, this computer’s agents are not asked for plans, and task pages show no Plans section.";

const liveLine = (plans: PeerPlansStatus) => {
  const live = plans.counts.reduce((n, row) => n + row.plans, 0);
  const tasks = plans.counts.filter((row) => row.plans > 0).length;
  return live === 0
    ? "No live plans on tasks."
    : `${live} live ${live === 1 ? "plan" : "plans"} on ${tasks} ${tasks === 1 ? "task" : "tasks"}.`;
};

function hubLine(plans: PeerPlansStatus, now: number): string {
  switch (plans.hubSupport) {
    case "supported": {
      const at = plans.lastContact === undefined ? Number.NaN : Date.parse(plans.lastContact);
      return Number.isFinite(at)
        ? `The Hub serves plans; last contact ${agoInWords(at, now)}.`
        : "The Hub serves plans.";
    }
    case "unsupported":
      return "The Hub did not serve plans when Peer last asked.";
    case "unknown":
      return "The Hub has not been asked yet.";
  }
}

/**
 * The state line of Settings' Plans row: what Plans holds now and what the Hub says while it is
 * active, what being inactive means while it is not. Why it is inactive is the plugin list's to
 * say (its chip and note), so it is not said twice. Null while the environment lists no Plans.
 */
export function plansSettingsState(
  plugin: PeerPluginState | undefined,
  plans: PeerPlansStatus | undefined,
  now: number,
): string | null {
  if (plugin === undefined) return null;
  if (!plugin.active) return INACTIVE_LINE;
  return plans === undefined ? null : `${liveLine(plans)} ${hubLine(plans, now)}`;
}
