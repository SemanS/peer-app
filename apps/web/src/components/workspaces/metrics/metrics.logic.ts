import type {
  PeerHubProjectUsage,
  PeerMetricsSummary,
  PeerMetricsStatus,
  PeerTask,
  PeerWorkspaceRole,
} from "@t3tools/contracts";
import { metricsView, taskTokenRows } from "@t3tools/client-runtime/peer/metrics";
export const initialMetricsView = { scope: "environment", window: 28, expanded: false } as const;
export const metricsDayShift = (day: string, offset: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
/**
 * Whether Team can be chosen as what the metrics are about, and where it cannot, why (the Hub's
 * reason, shown beside the choice and not in a tooltip) and what the person can do about it. Only
 * a team that is off can be turned on, by an admin; a Hub that lacks team metrics or cannot be
 * reached has nothing to turn on. Without a summary yet Team is not offered and nothing is said.
 */
export interface TeamChoice {
  readonly available: boolean;
  /** The choice as labelled: "Team", or "Team · off" / "Team · unavailable" where it cannot be chosen. */
  readonly label: string;
  readonly reason: string | null;
  readonly action: "turn-on" | "ask-admin" | null;
}

export function teamChoice(
  team: PeerMetricsSummary["team"] | undefined,
  role: PeerWorkspaceRole,
): TeamChoice {
  if (team === undefined) return { available: false, label: "Team", reason: null, action: null };
  if (team.state === "on") return { available: true, label: "Team", reason: null, action: null };
  return {
    available: false,
    label: team.state === "off" ? "Team · off" : "Team · unavailable",
    reason: team.reason,
    action:
      team.state !== "off" ? null : role === "owner" || role === "admin" ? "turn-on" : "ask-admin",
  };
}

/** What each action says; an admin's opens the page with the switch, a member's is a line to read. */
export const TEAM_ACTION_TEXT = {
  "turn-on": "Turn on in Workspace › People",
  "ask-admin": "Ask an admin to turn it on.",
} as const;

export function metricsSection(
  summary: PeerMetricsSummary,
  tasks: ReadonlyArray<PeerTask>,
  coordinationEnabled: boolean,
  role: PeerWorkspaceRole,
) {
  const rows = taskTokenRows(summary.current, tasks);
  return {
    ...metricsView(summary, { coordinationEnabled }),
    taskRows: rows.slice(0, 10),
    otherTasks: Math.max(0, rows.length - 10),
    team: teamChoice(summary.team, role),
    incomplete: summary.current.incomplete === true,
    computedAt: summary.computedAt,
  };
}
export function metricsSpend(
  usage: PeerHubProjectUsage | null | undefined,
  enabled: boolean,
  failed: boolean,
  email: string | null,
) {
  const footnote =
    "Money per task is not measured: the gateway does not attribute spend to tasks. This billing period can differ from the metrics window.";
  if (!enabled) return { text: "Shared-capacity plugin is not active.", footnote };
  if (failed)
    return { text: "The gateway could not be reached; task tokens remain available.", footnote };
  if (!usage?.shared) return { text: "The gateway has no spend measurement available.", footnote };
  const shared = usage.shared,
    own = shared.members.find((m) => m.id === email);
  return {
    text: `${shared.spent} of ${shared.budget} ${usage.currency}/${shared.period}${own ? `; your spend ${own.spent}${own.allocation === null ? "" : ` of your ${own.allocation} share`} ${usage.currency}` : ""}.`,
    footnote,
  };
}
export function metricsSettingsState(
  role: PeerWorkspaceRole,
  owner: boolean,
  team: PeerMetricsSummary["team"] | undefined,
  debug: PeerMetricsStatus["debug"] | undefined,
) {
  return {
    admin: owner && (role === "owner" || role === "admin"),
    canEnableTeam: team?.state === "on" || team?.state === "off",
    canShare: owner,
    canStartSharing: owner && team?.state !== "unsupported",
    debugState: debug?.forced ? "forced" : debug?.on ? "timed" : "off",
    debugUntil: debug?.until,
  };
}
