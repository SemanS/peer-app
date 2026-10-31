/**
 * The acceptance plugin's client logic, for web and the phone alike: a task's acceptance as the
 * status carries it (who and when, without the note) and as its page reads it (with the note and
 * the history), who may accept or withdraw, and the words the task row, the task page and the Team
 * page say. Acceptance is a fact on the task and gates nothing: these words never say a task is
 * blocked by it. The Hub decides every change.
 *
 * @module peer/acceptance
 */
import {
  WS_METHODS,
  type EnvironmentId,
  type PeerAcceptance,
  type PeerAcceptanceEvent,
  type PeerAcceptancePlace,
  type PeerAcceptanceSummary,
  type PeerAcceptanceVia,
  type PeerHandoffPackage,
  type PeerHubStatus,
  type PeerProject,
  type PeerTaskAcceptance,
  type PeerWorkspaceState,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import type { Atom } from "effect/reactivity";

import type * as EnvironmentRegistry from "../connection/registry.ts";
import { request } from "../rpc/client.ts";
import {
  createEnvironmentQueryAtomFamily,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";

/**
 * The plugin's atoms, spread into the server atoms: a task's acceptance with its history, read
 * while its page is open and again whenever `revision` (`acceptanceRevision`, never sent) moves,
 * and a lead's accept and withdraw.
 */
export function createPeerAcceptanceAtoms<R, ER>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, ER>,
) {
  // Always fresh: a current signal is the point of the read, and `revision` is never sent.
  const signals = createEnvironmentQueryAtomFamily(runtime, {
    label: "peer:acceptance:signals",
    staleTimeMs: 0,
    idleTtlMs: 0,
    execute: (input: PeerAcceptancePlace & { readonly revision: string }) =>
      request(WS_METHODS.peerAcceptanceSignals, {
        workspace: input.workspace,
        project: input.project,
        task: input.task,
      }),
  });
  const view = createEnvironmentQueryAtomFamily(runtime, {
    label: "peer:acceptance:view",
    staleTimeMs: 0,
    idleTtlMs: 0,
    execute: (input: PeerAcceptancePlace & { readonly revision: string }) =>
      request(WS_METHODS.peerAcceptanceView, {
        workspace: input.workspace,
        project: input.project,
        task: input.task,
      }),
  });
  return {
    peerAcceptanceView: (target: {
      readonly environmentId: EnvironmentId;
      readonly input: PeerAcceptancePlace;
      readonly revision: string;
    }) =>
      view({
        environmentId: target.environmentId,
        input: { ...target.input, revision: target.revision },
      }),
    peerAcceptanceSignals: (target: {
      readonly environmentId: EnvironmentId;
      readonly input: PeerAcceptancePlace;
      readonly revision: string;
    }) =>
      signals({
        environmentId: target.environmentId,
        input: { ...target.input, revision: target.revision },
      }),
    peerAcceptanceAccept: createEnvironmentRpcCommand(runtime, {
      label: "peer:acceptance:accept",
      tag: WS_METHODS.peerAcceptanceAccept,
    }),
    peerAcceptanceWithdraw: createEnvironmentRpcCommand(runtime, {
      label: "peer:acceptance:withdraw",
      tag: WS_METHODS.peerAcceptanceWithdraw,
    }),
    /** A project's review policy, for its settings section. */
    peerAcceptanceReviewPolicy: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "peer:acceptance:reviewPolicy",
      tag: WS_METHODS.peerAcceptanceReviewPolicy,
      staleTimeMs: 0,
    }),
    peerAcceptanceSetReviewPolicy: createEnvironmentRpcCommand(runtime, {
      label: "peer:acceptance:setReviewPolicy",
      tag: WS_METHODS.peerAcceptanceSetReviewPolicy,
    }),
  };
}

/** A task's state as acceptance reads it: the Hub's `open`, `review` or `done`. */
export type DeliveryStatus = "open" | "review" | "done";

/** A task's current acceptance in the status; undefined while it has none (or it is not known). */
export const taskAcceptance = (
  status: Pick<PeerHubStatus, "acceptance">,
  place: PeerAcceptancePlace,
): PeerAcceptanceSummary | undefined =>
  status.acceptance?.accepted.find(
    (row) =>
      row.workspace === place.workspace && row.project === place.project && row.task === place.task,
  );

/**
 * The cache key of a task's acceptance: who accepted and when, or none, so an acceptance and its
 * withdrawal each read the task's page again.
 */
export const acceptanceRevision = (
  status: Pick<PeerHubStatus, "acceptance">,
  place: PeerAcceptancePlace,
) => {
  const row = taskAcceptance(status, place);
  return row === undefined ? "none" : `${row.by}@${row.at}`;
};

/** A lead of the project, or the workspace's admin or owner: who the Hub lets accept and withdraw. */
export const mayAccept = (
  workspace: Pick<PeerWorkspaceState, "role">,
  project: Pick<PeerProject, "role">,
) => project.role === "lead" || workspace.role !== "member";

/**
 * A current acceptance as these words read it: who gave it, and whether the task was reopened after
 * it, as the Hub says (`beforeReopening`, on the status's summary and on a task's read). Without it
 * (an older Peer) a task open now is taken as reopened.
 */
export type CurrentAcceptance = Pick<PeerAcceptance, "by"> & {
  readonly beforeReopening?: boolean | undefined;
  /** `policy` when the project's review policy gave it in `by`'s name. */
  readonly via?: PeerAcceptanceVia | undefined;
};

/** " via policy" for an acceptance the review policy gave, nothing for a person's own. */
const viaWords = (via: PeerAcceptanceVia | undefined) => (via === "policy" ? " via policy" : "");

const reopenedAfter = (current: CurrentAcceptance, task: DeliveryStatus) =>
  current.beforeReopening ?? task === "open";

/** A task's read as these words take it: its current acceptance with `beforeReopening`, or undefined. */
export const currentOf = (view: PeerTaskAcceptance) =>
  view.current === null
    ? undefined
    : {
        ...view.current,
        ...(view.beforeReopening === undefined ? {} : { beforeReopening: view.beforeReopening }),
      };

/**
 * Where a task stands: `accepted`; `accepted-before-reopening` (reopened after it, open or delivered
 * again); `not-accepted` (done without one, which is fine: acceptance stops nothing); `none` (open
 * or in review, with none).
 */
export type AcceptanceState = "accepted" | "accepted-before-reopening" | "not-accepted" | "none";

export function acceptanceState(
  current: CurrentAcceptance | null | undefined,
  task: DeliveryStatus,
): AcceptanceState {
  if (current !== null && current !== undefined)
    return reopenedAfter(current, task) ? "accepted-before-reopening" : "accepted";
  return task === "done" ? "not-accepted" : "none";
}

/**
 * What a lead may do now: accept a delivered task with no acceptance, or one whose acceptance was
 * given before it was reopened and delivered again; withdraw one that stands.
 */
export function acceptanceActions(input: {
  readonly allowed: boolean;
  readonly current: CurrentAcceptance | null | undefined;
  readonly task: DeliveryStatus;
}): ReadonlyArray<"accept" | "withdraw"> {
  if (!input.allowed) return [];
  if (input.current !== null && input.current !== undefined)
    return input.task !== "open" && reopenedAfter(input.current, input.task)
      ? ["accept", "withdraw"]
      : ["withdraw"];
  return input.task === "open" ? [] : ["accept"];
}

/** A task row's mark: "Accepted", or "Accepted before reopening"; null with none. */
export function acceptanceBadge(state: AcceptanceState): string | null {
  return state === "accepted"
    ? "Accepted"
    : state === "accepted-before-reopening"
      ? "Accepted before reopening"
      : null;
}

/** A moment as the task page says it: "28 Oct, 10:00", in the reader's own time. */
export const acceptedAtLabel = (at: string) => {
  const date = DateTime.make(at);
  return Option.isNone(date)
    ? at
    : DateTime.formatLocal(date.value, {
        locale: "en-GB",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
};

/** What a workspace calls a person: their name on one of its projects, else one made of the address. */
export function personName(
  status: Pick<PeerHubStatus, "workspaces">,
  workspace: string,
  email: string,
): string {
  const lower = email.toLowerCase();
  for (const project of status.workspaces.find((w) => w.slug === workspace)?.projects ?? []) {
    const name = project.project.members.find((m) => m.email.toLowerCase() === lower)?.name;
    if (name !== undefined && name !== "") return name;
  }
  const local = email.split("@")[0]?.split(/[._-]/)[0] ?? email;
  return local === "" ? email : `${local[0]?.toUpperCase() ?? ""}${local.slice(1)}`;
}

/**
 * The card's heading: "Accepted by Ana · 28 Oct, 10:00" ("Accepted by Ana via policy · …" for the
 * policy's), with "before reopening" once reopened.
 */
export function acceptedLine(
  current: CurrentAcceptance & Pick<PeerAcceptance, "at">,
  task: DeliveryStatus,
  nameOf: (email: string) => string,
  clock: (at: string) => string = acceptedAtLabel,
): string {
  return `Accepted by ${nameOf(current.by)}${viaWords(current.via)} · ${clock(current.at)}${reopenedAfter(current, task) ? " · before reopening" : ""}`;
}

/**
 * One history entry as the card lists it: "Withdrawn by Ana · 28 Oct, 11:00", "Accepted by Ana via
 * policy · 28 Oct, 10:00", its note apart.
 */
export function historyLine(
  event: Pick<PeerAcceptanceEvent, "kind" | "by" | "at" | "via">,
  nameOf: (email: string) => string,
  clock: (at: string) => string = acceptedAtLabel,
): string {
  const verb =
    event.kind === "accepted" ? "Accepted" : event.kind === "withdrawn" ? "Withdrawn" : event.kind;
  return `${verb} by ${nameOf(event.by)}${viaWords(event.via)} · ${clock(event.at)}`;
}

/** The history newest first, as the card lists it. */
export const historyNewestFirst = (history: ReadonlyArray<PeerAcceptanceEvent>) =>
  [...history].sort((a, b) => b.at.localeCompare(a.at));

/**
 * The Team page's fact on a task's row: "accepted by Ana", "accepted by Ana before reopening", or
 * "done · not accepted" for a done task with none; undefined for an open or reviewed task with none.
 */
export function teamAcceptanceFact(
  row: Pick<PeerAcceptanceSummary, "by" | "beforeReopening" | "via"> | undefined,
  task: DeliveryStatus,
  nameOf: (email: string) => string,
): string | undefined {
  const state = acceptanceState(row, task);
  switch (state) {
    case "accepted":
      return `accepted by ${nameOf(row!.by)}${viaWords(row!.via)}`;
    case "accepted-before-reopening":
      return `accepted by ${nameOf(row!.by)}${viaWords(row!.via)} before reopening`;
    case "not-accepted":
      return "done · not accepted";
    case "none":
      return undefined;
  }
}

/** A delivery status from a work tree's task node. */
export const deliveryOf = (task: {
  readonly done: boolean;
  readonly inReview?: boolean | undefined;
}): DeliveryStatus => (task.done ? "done" : task.inReview === true ? "review" : "open");

/**
 * The acceptance a handoff package carries, in one line for the reviewer's card: "Accepted by Ana ·
 * 28 Oct, 10:00". Null for a package without one (none given, or a Hub without acceptance).
 */
export function handoffAcceptanceLine(
  acceptance: PeerHandoffPackage["acceptance"],
  nameOf: (email: string) => string,
  clock: (at: string) => string = acceptedAtLabel,
): string | null {
  return acceptance === undefined
    ? null
    : `Accepted by ${nameOf(acceptance.by)} · ${clock(acceptance.at)}`;
}
