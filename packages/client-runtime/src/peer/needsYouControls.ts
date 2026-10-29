import {
  AuthAccessWriteScope,
  STALE_INPUT_WAIT_MS,
  overlapAttention,
  overlapHandover,
  type PeerHubStatus,
  type PeerOverlap,
} from "@t3tools/contracts";
import type { NeedsYouEnvironment, NeedsYouItem, AgentNeed } from "./needsYou.ts";

/**
 * T3 Connect is the relay that carries phone alerts, so its name stays where it names that service;
 * the first time a line mentions it, it says what it is.
 */
const RELAY = "T3 Connect, Peer’s relay";
export function alertsControlState(
  status: Pick<PeerHubStatus, "needsYou"> | null,
  scopes: ReadonlyArray<string>,
) {
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
      ? `Link this computer to ${RELAY}. A direct connection alone cannot send Phone alerts.`
      : alerts.delivery === "publishing-off"
        ? `Turn on agent activity publishing for this computer in ${RELAY}.`
        : `Titles only, sent to your phone through ${RELAY}. Alerts follow its notification and quiet switches. Turn them on for one computer.`;
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
/** The overlap's sessions that its workspace and project still see at work. */
export function overlapSessionsAtWork(
  status: PeerHubStatus,
  overlap: PeerOverlap,
): ReadonlyArray<PeerHubStatus["coordination"]["sessions"][number]> {
  return status.coordination.sessions.filter(
    (session) =>
      session.workspace === overlap.workspace &&
      session.project === overlap.project &&
      overlap.sessions.includes(session.id),
  );
}

/**
 * Why an overlap is the person's to close although its agents never agreed: a handover note no
 * agent wrote after, or none of its sessions at work. Undefined while an agent can still settle it.
 */
export function overlapEndedReason(
  overlap: PeerOverlap,
  atWork: ReadonlyArray<string>,
): "handover" | "gone" | undefined {
  if (overlap.state !== "open") return undefined;
  const handover = overlapHandover(overlap.notes);
  if (
    handover !== undefined &&
    overlap.notes
      .slice(overlap.notes.indexOf(handover) + 1)
      .every((note) => note.session === undefined)
  )
    return "handover";
  return overlap.sessions.some((session) => atWork.includes(session)) ? undefined : "gone";
}

export function needsYouTickNeeded(environments: ReadonlyArray<NeedsYouEnvironment>, now: number) {
  return environments.some(
    ({ connected, status }) =>
      connected &&
      status?.signedIn &&
      ((status.coordination.enabled &&
        status.coordination.overlaps.some((overlap) => {
          const atWork = overlapSessionsAtWork(status, overlap).map((session) => session.id);
          const phase = overlapAttention(overlap, now, atWork);
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
    | {
        kind: "overlap";
        phase: "decide" | "unanswered";
        participants: ReadonlyArray<string>;
        reason?: "handover" | "gone" | undefined;
      }
    | { kind: "stale" }
    | { kind: "owner-call"; onBehalf: boolean },
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
        label:
          item.reason !== undefined
            ? "Agents ended"
            : item.phase === "unanswered"
              ? "Agreement not reached"
              : "Needs coordination",
        guidance: item.participants.join(" + "),
      };
    case "stale":
      return {
        label: "Inputs changed",
        guidance: "Agent must update these inputs before handoff.",
      };
    case "owner-call":
      return {
        label: "Owner's call",
        guidance: item.onBehalf
          ? "As a lead you can decide for the owner. The record says you did."
          : "Accept or decline, with a note for the agent.",
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
            ? "Starting the agent was not confirmed. Check herdr before starting another agent, and inspect whether this request was accepted."
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

/** Keep the form alive during startup; an accepted Hub row alone does not prove execution. */
export function requestSheetOutcome(
  status: string | undefined,
  busy: boolean,
  launch: "accepted" | "start-not-confirmed" | null,
) {
  if (status !== undefined && status !== "pending" && status !== "accepted")
    return "no-longer-pending" as const;
  if (launch !== null) return launch;
  if (busy) return undefined;
  return status === "accepted" ? ("accepted" as const) : undefined;
}
