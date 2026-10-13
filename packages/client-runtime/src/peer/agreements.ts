/**
 * The agreements plugin's client logic, for web and the phone alike: what the agents of two tasks
 * agreed when they settled an overlap, as a task's page lists it, whom it waits on when it falls due
 * with no agent on the task, whether a person may bring a closed one back, and the words each state
 * is told in. The Hub works out an agreement's state for the reader, so none of this judges whether
 * a task has landed: it reads what the view says.
 *
 * @module peer/agreements
 */
import {
  WS_METHODS,
  isPeerAgreementPersonReason,
  type EnvironmentId,
  type PeerAgreement,
  type PeerAgreementClosed,
  type PeerAgreementsPlace,
  type PeerAgreementsStatus,
  type PeerAgreementsView,
} from "@t3tools/contracts";
import type { Atom } from "effect/unstable/reactivity";

import type * as EnvironmentRegistry from "../connection/registry.ts";
import { request } from "../rpc/client.ts";
import { createEnvironmentQueryAtomFamily, createEnvironmentRpcCommand } from "../state/runtime.ts";

/**
 * The agreements plugin's atoms, spread into the server atoms: a place's view, read from the Hub
 * through the environment, and the two things a person does with an agreement. A view is read
 * whenever it is opened and kept no longer than it is watched, since what a person may see of a
 * project's agreements is theirs alone. `revision` is a cache key and never sent: pass
 * `agreementsRevision` of the status field, and the view is read again when it moves.
 */
export function createPeerAgreementsAtoms<R, ER>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, ER>,
) {
  const view = createEnvironmentQueryAtomFamily(runtime, {
    label: "peer:agreements:view",
    staleTimeMs: 0,
    idleTtlMs: 0,
    execute: (input: PeerAgreementsPlace & { readonly revision?: string | undefined }) =>
      request(WS_METHODS.peerAgreementsView, {
        workspace: input.workspace,
        ...(input.project === undefined ? {} : { project: input.project }),
      }),
  });
  return {
    /** The agreements of a place; narrow it to a project with `input.project`. */
    peerAgreementsView: (target: {
      readonly environmentId: EnvironmentId;
      readonly input: PeerAgreementsPlace;
      readonly revision?: string | undefined;
    }) =>
      view({
        environmentId: target.environmentId,
        input: {
          workspace: target.input.workspace,
          ...(target.input.project === undefined ? {} : { project: target.input.project }),
          ...(target.revision === undefined ? {} : { revision: target.revision }),
        },
      }),
    /** Close an open or due agreement as handled or not needed; the Hub answers with its state. */
    peerAgreementsClose: createEnvironmentRpcCommand(runtime, {
      label: "peer:agreements:close",
      tag: WS_METHODS.peerAgreementsClose,
    }),
    /** Bring back one a person closed; the Hub refuses once a task landed, or after 30 days. */
    peerAgreementsReopen: createEnvironmentRpcCommand(runtime, {
      label: "peer:agreements:reopen",
      tag: WS_METHODS.peerAgreementsReopen,
    }),
  };
}

/**
 * The cache key of a workspace's view, from the status field alone: it moves with the count of
 * agreements not closed and with the ones due for the person, which is what the field carries. An
 * agreement replaced by another changes neither, and is read when the view is opened again.
 */
export function agreementsRevision(
  status: PeerAgreementsStatus | undefined,
  workspace: string,
): string {
  const row = status?.workspaces.find((candidate) => candidate.workspace === workspace);
  return row === undefined
    ? ""
    : `${row.open}|${row.dueForMe.map((due) => `${due.project}/${due.id}`).join(",")}`;
}

/**
 * How a task is named in the set of tasks with a live agent: `project/task`. A client builds that set
 * from the coordination sessions it knows, with this key, for `dueForPerson`.
 */
export const agreementTaskKey = (project: string, task: string) => `${project}/${task}`;

/** An agreement can be reopened within this long after it was settled, as the Hub allows. */
export const AGREEMENT_REOPEN_WITHIN_MS = 30 * 24 * 60 * 60_000;

/** The moment an agreement was settled; one that cannot be read counts as the oldest. */
const settledMs = (agreement: PeerAgreement) => {
  const at = Date.parse(agreement.settledAt);
  return Number.isFinite(at) ? at : 0;
};

/** Newest settled first; the same moment falls back to the id, so every client orders alike. */
const newestFirst = (a: PeerAgreement, b: PeerAgreement) =>
  settledMs(b) - settledMs(a) || a.id.localeCompare(b.id);

const isClosed = (agreement: PeerAgreement) => agreement.state === "closed";

/**
 * The agreements of a task, as its page lists them: those not closed first (open, due, and any
 * state a newer Hub names), then the closed ones, each newest settled first. An agreement is of the
 * task when the task is one of its pair, in the project.
 */
export function agreementsOfTask(
  view: Pick<PeerAgreementsView, "agreements"> | undefined,
  project: string,
  task: string,
): ReadonlyArray<PeerAgreement> {
  return (view?.agreements ?? [])
    .filter((agreement) => agreement.project === project && agreement.tasks.includes(task))
    .sort((a, b) => Number(isClosed(a)) - Number(isClosed(b)) || newestFirst(a, b));
}

/** The other task of the pair, from one task's side; undefined for a task that is not in it. */
export const otherTask = (
  agreement: Pick<PeerAgreement, "tasks">,
  task: string,
): string | undefined =>
  agreement.tasks.includes(task) ? agreement.tasks.find((id) => id !== task) : undefined;

/**
 * The agreements that wait on a person with nobody to hear them: due, with the person's agent among
 * those that took part on the task that has not landed, while that task has no live agent
 * (`liveTasks` holds the `agreementTaskKey` of each task that has one). Newest settled first.
 */
export function dueForPerson(
  view: Pick<PeerAgreementsView, "agreements"> | undefined,
  email: string,
  liveTasks: ReadonlySet<string>,
): ReadonlyArray<PeerAgreement> {
  const person = email.toLowerCase();
  return (view?.agreements ?? [])
    .filter((agreement) => {
      const due = agreement.dueFor;
      return (
        agreement.state === "due" &&
        due !== undefined &&
        !liveTasks.has(agreementTaskKey(agreement.project, due)) &&
        agreement.sides.some((side) => side.task === due && side.email.toLowerCase() === person)
      );
    })
    .sort(newestFirst);
}

/** A person can close an agreement that is open or due. */
export const canClose = (agreement: Pick<PeerAgreement, "state">): boolean =>
  agreement.state === "open" || agreement.state === "due";

/**
 * Whether a person can bring a closed agreement back: a person closed it (as handled or not
 * needed, not the Hub), no task has landed, and it was settled less than 30 days before `now`
 * (milliseconds since the epoch). The Hub decides in the end and answers `409` otherwise.
 */
export function canReopen(agreement: PeerAgreement, now: number): boolean {
  const { closed } = agreement;
  if (agreement.state !== "closed" || closed?.by === undefined) return false;
  if (!isPeerAgreementPersonReason(closed.why) || agreement.landed.length > 0) return false;
  const settled = Date.parse(agreement.settledAt);
  return Number.isFinite(settled) && now - settled < AGREEMENT_REOPEN_WITHIN_MS;
}

/**
 * A closing in a few words: "Closed · handled by Ana", "Closed · not needed", "Replaced",
 * "Task removed", "Expired", "Both landed", and "Closed" for a reason it does not know.
 * `personLabel` names whoever closed it; the address by default.
 */
export function agreementClosedLabel(
  closed: PeerAgreementClosed | undefined,
  personLabel: (email: string) => string = (email) => email,
): string {
  switch (closed?.why) {
    case "handled":
    case "not-needed": {
      const words = closed.why === "handled" ? "handled" : "not needed";
      return closed.by === undefined
        ? `Closed · ${words}`
        : `Closed · ${words} by ${personLabel(closed.by)}`;
    }
    case "replaced":
      return "Replaced";
    case "removed":
      return "Task removed";
    case "expired":
      return "Expired";
    case "landed":
      return "Both landed";
    default:
      return "Closed";
  }
}

/**
 * An agreement's state in a few words, the same on web and the phone: "Open", "Due — KRK-1 landed"
 * (`taskLabel` names the task that landed), or how it closed. A state a newer Hub names reads
 * "Unknown state", a closing it names "Closed". `personLabel` names whoever closed it; the address
 * by default.
 */
export function agreementStateLabel(
  agreement: PeerAgreement,
  taskLabel: (task: string) => string,
  personLabel?: (email: string) => string,
): string {
  switch (agreement.state) {
    case "open":
      return "Open";
    case "due": {
      const landed =
        (agreement.dueFor === undefined ? undefined : otherTask(agreement, agreement.dueFor)) ??
        agreement.landed[0];
      return landed === undefined ? "Due" : `Due — ${taskLabel(landed)} landed`;
    }
    case "closed":
      return agreementClosedLabel(agreement.closed, personLabel);
    default:
      return "Unknown state";
  }
}
