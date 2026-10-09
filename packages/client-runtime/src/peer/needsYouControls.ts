import {
  AuthAccessWriteScope,
  STALE_INPUT_WAIT_MS,
  overlapAttention,
  type PeerHubStatus,
} from "@t3tools/contracts";
import type { NeedsYouEnvironment, NeedsYouItem, ActiveAgentNode, AgentNeed } from "./needsYou.ts";

export function workingAgents(agents: ReadonlyArray<ActiveAgentNode>) {
  return agents.filter((agent) => agent.needs === undefined);
}
export function alertsControlState(status: PeerHubStatus | null, scopes: ReadonlyArray<string>) {
  const alerts = status?.needsYou?.alerts;
  if (!alerts)
    return {
      state: "hidden" as const,
      enabled: false,
      disabled: true,
      explanation: "Update Peer on this computer to use Phone alerts.",
    };
  const permitted = scopes.includes(AuthAccessWriteScope);
  const explanation = !permitted
    ? "Only this computer’s owner can change Phone alerts."
    : alerts.delivery === "not-linked"
      ? "Link this computer to T3 Connect. A direct connection alone cannot send Phone alerts."
      : alerts.delivery === "publishing-off"
        ? "Turn on agent activity publishing for this computer in T3 Connect."
        : "Titles only. Alerts follow T3 Connect’s notification and quiet switches. Turn them on for one computer.";
  return {
    state: !permitted
      ? ("no-permission" as const)
      : alerts.delivery === "ready"
        ? alerts.enabled
          ? ("ready-on" as const)
          : ("ready-off" as const)
        : alerts.delivery,
    enabled: alerts.enabled,
    disabled: !permitted,
    explanation,
  };
}
export function alertsRowState(
  environmentId: string,
  environments: ReadonlyArray<NeedsYouEnvironment>,
  scopes: ReadonlyArray<string>,
) {
  const current = environments.find((environment) => environment.environmentId === environmentId);
  const duplicates =
    !current?.connected || !current.status?.needsYou?.alerts.enabled || !current.status.email
      ? []
      : environments.filter(
          (environment) =>
            environment.environmentId !== environmentId &&
            environment.connected &&
            environment.status?.signedIn &&
            environment.status.email === current.status?.email &&
            environment.status.needsYou?.alerts.enabled,
        );
  return {
    ...alertsControlState(current?.status ?? null, scopes),
    duplicates: duplicates.map((environment) => ({
      environmentId: environment.environmentId,
      label: environment.label,
    })),
    turnOffTarget: environmentId,
  };
}
export function needsYouTickNeeded(environments: ReadonlyArray<NeedsYouEnvironment>, now: number) {
  return environments.some(
    ({ connected, status }) =>
      connected &&
      status?.signedIn &&
      ((status.coordination.enabled &&
        status.coordination.overlaps.some((overlap) => {
          const phase = overlapAttention(overlap, now);
          return (phase === "recent" && overlap.policy === "ask") || phase === "requested";
        })) ||
        (status.needsYou?.staleInputs ?? []).some(
          (stale) => now - Date.parse(stale.since) < STALE_INPUT_WAIT_MS,
        )),
  );
}
export function needsYouCardCopy(
  item:
    | { kind: "thread"; need: AgentNeed }
    | { kind: "agent"; need: "input" | "review" }
    | { kind: "request" }
    | { kind: "overlap"; phase: "decide" | "unanswered"; participants: ReadonlyArray<string> }
    | { kind: "stale" },
) {
  switch (item.kind) {
    case "thread":
      return {
        label:
          item.need === "approval"
            ? "Needs approval"
            : item.need === "input"
              ? "Needs input"
              : "Finished",
        guidance:
          item.need === "review"
            ? "Open the thread to review the result."
            : "Open the thread to answer.",
      };
    case "agent":
      return {
        label: item.need === "input" ? "Needs input" : "Finished",
        guidance:
          item.need === "input" ? "Answer it in herdr." : "Open the agent to review the result.",
      };
    case "request":
      return {
        label: "Team request",
        guidance: "Review the request, then choose a computer to accept and start.",
      };
    case "overlap":
      return {
        label: item.phase === "unanswered" ? "Agreement not reached" : "Needs coordination",
        guidance: item.participants.join(" + "),
      };
    case "stale":
      return {
        label: "Inputs changed",
        guidance: "Agent must update these inputs before handoff.",
      };
  }
}
export function needsYouNotice(input: {
  focus?: string;
  found: boolean;
  connected: boolean;
  loaded: boolean;
}) {
  if (!input.connected) return "Connect the computer to see what needs you.";
  if (!input.loaded) return "Loading what needs you…";
  if (input.focus && !input.found) return "This item has already been handled.";
  return null;
}
export function requestActionState(
  item: Pick<Extract<NeedsYouItem, { kind: "request" }>, "computers">,
  outcome?: "accepted" | "no-longer-pending" | "start-not-confirmed",
) {
  return {
    computers: item.computers,
    ready: item.computers.filter((computer) => computer.blocker === null),
    message:
      outcome === "accepted"
        ? "Accepted. See Recently accepted for its record."
        : outcome === "no-longer-pending"
          ? "This request is no longer pending."
          : outcome === "start-not-confirmed"
            ? "Acceptance was recorded, but starting the agent was not confirmed. Check herdr before starting another agent."
            : null,
    retry: false,
  };
}
export function overlapActionAvailability(input: {
  connected: boolean;
  coordination: boolean;
  hubError: boolean;
  canOperate: boolean;
}) {
  const reason = !input.connected
    ? "Connect this computer first."
    : !input.coordination
      ? "Coordination is turned off on this computer."
      : input.hubError
        ? "The Peer Hub is unreachable."
        : !input.canOperate
          ? "This pairing cannot operate on this computer."
          : null;
  return { disabled: reason !== null, reason };
}
export const shouldShowHomeRow = (count: number) => count > 0;
