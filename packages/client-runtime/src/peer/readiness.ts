/**
 * Readiness of a task's dependencies, as a view over the status: for each task a task depends on,
 * whether it is done, landed, shared in flight or not yet delivered, from its state (dependencies),
 * its newest handoff's delivery (handoff summaries) and its acceptance. Nothing here schedules,
 * starts or blocks anything; the words say what a dependency still lacks.
 *
 * A dependency shared in flight is reachable by others, so a dependent can build on it: only one
 * not yet delivered keeps a dependent from being ready ("ready when 1.2 also lands").
 *
 * @module peer/readiness
 */
import type {
  PeerDependencySnapshot,
  PeerDependencyState,
  PeerHandoffDelivery,
  PeerHandoffDeliveryState,
  PeerHubStatus,
  PeerTask,
} from "@t3tools/contracts";

import { dependenciesOf, dependencyName, neededBy, type DependencyIndex } from "./dependencies.ts";

/** What a dependency is, as a dependent reads it. */
export type DependencyReadiness = "done" | "landed" | "in-flight" | "waiting";

/** The word a task page says beside a dependency: "VL1 · shared in flight". */
export const READINESS_WORDS: Readonly<Record<DependencyReadiness, string>> = {
  done: "done",
  landed: "landed",
  "in-flight": "shared in flight",
  waiting: "not yet delivered",
};

/**
 * A dependency's readiness: done when the task is done; landed when every pull request merged or
 * its newest handoff's delivery is `landed`; in flight when that delivery is `shared`; otherwise
 * (`local`, `none`, not observed, or no handoff) waiting.
 */
export function readinessOf(
  state: PeerDependencyState,
  delivery: PeerHandoffDeliveryState | undefined,
): DependencyReadiness {
  if (state === "done") return "done";
  if (state === "merged" || delivery === "landed") return "landed";
  return delivery === "shared" ? "in-flight" : "waiting";
}

/** What the status says of a project's tasks beyond their state: newest delivery and acceptance. */
export interface ReadinessFacts {
  /** Task id → the delivery of its newest handoff that carries one. */
  readonly deliveries: ReadonlyMap<string, PeerHandoffDelivery>;
  /** Task ids with a current acceptance. */
  readonly accepted: ReadonlySet<string>;
}

const time = (at: string) => {
  const ms = Date.parse(at);
  return Number.isFinite(ms) ? ms : 0;
};

/**
 * A project's readiness facts from the status. Of a task's handoffs (one per author) the newest
 * that carries a delivery speaks; a package from an older app or Hub carries none.
 */
export function readinessFacts(
  status: Pick<PeerHubStatus, "handoff" | "acceptance">,
  workspace: string,
  project: string,
): ReadinessFacts {
  const newest = new Map<string, { at: number; delivery: PeerHandoffDelivery }>();
  for (const summary of status.handoff?.summaries ?? []) {
    if (summary.workspace !== workspace || summary.project !== project) continue;
    if (summary.delivery === undefined) continue;
    const at = time(summary.composedAt);
    const known = newest.get(summary.task);
    if (known === undefined || at > known.at)
      newest.set(summary.task, { at, delivery: summary.delivery });
  }
  return {
    deliveries: new Map([...newest].map(([task, { delivery }]) => [task, delivery])),
    accepted: new Set(
      (status.acceptance?.accepted ?? [])
        .filter((row) => row.workspace === workspace && row.project === project)
        .map((row) => row.task),
    ),
  };
}

/** One dependency as a task page lists it. */
export interface ReadinessRow {
  readonly task: PeerTask;
  readonly state: PeerDependencyState;
  readonly readiness: DependencyReadiness;
  /** `READINESS_WORDS[readiness]`. */
  readonly word: string;
  readonly delivery: PeerHandoffDelivery | undefined;
  readonly accepted: boolean;
}

export function readinessRow(
  item: { readonly task: PeerTask; readonly state: PeerDependencyState },
  facts: ReadinessFacts,
): ReadinessRow {
  const delivery = facts.deliveries.get(item.task.id);
  const readiness = readinessOf(item.state, delivery?.state);
  return {
    task: item.task,
    state: item.state,
    readiness,
    word: READINESS_WORDS[readiness],
    delivery,
    accepted: facts.accepted.has(item.task.id),
  };
}

/** "VL1 · shared in flight". */
export const readinessLine = (row: Pick<ReadinessRow, "task" | "word">) =>
  `${dependencyName(row.task)} · ${row.word}`;

const names = (items: ReadonlyArray<{ readonly task: PeerTask }>) => {
  const all = items.map((item) => dependencyName(item.task));
  return all.length <= 1 ? (all[0] ?? "") : `${all.slice(0, -1).join(", ")} and ${all.at(-1)}`;
};

/** "ready", or "ready when 1.2 also lands", "ready when 1.2 and 1.4 also land". */
export const readyWhenLine = (waiting: ReadonlyArray<{ readonly task: PeerTask }>) =>
  waiting.length === 0
    ? "ready"
    : `ready when ${names(waiting)} also ${waiting.length === 1 ? "lands" : "land"}`;

/**
 * What a task depends on, each with its readiness, and when the task is ready: null for a task
 * that depends on nothing (or with the dependencies plugin off).
 */
export function dependsOnReadiness(
  snapshot: PeerDependencySnapshot | undefined,
  project: string,
  task: string,
  index: DependencyIndex,
  facts: ReadinessFacts,
): { readonly rows: ReadonlyArray<ReadinessRow>; readonly readyWhen: string | null } {
  const rows = dependenciesOf(snapshot, project, task, index).map((item) =>
    readinessRow(item, facts),
  );
  return {
    rows,
    readyWhen:
      rows.length === 0 ? null : readyWhenLine(rows.filter((row) => row.readiness === "waiting")),
  };
}

/** Dependents that wait for the same other dependencies, as one line of a review page. */
export interface DependentsGroup {
  readonly dependents: ReadonlyArray<PeerTask>;
  /** Their other dependencies not yet delivered. */
  readonly waitingOn: ReadonlyArray<ReadinessRow>;
  /** "3.1, 3.2 · ready when 1.2 also lands", "5.1 · ready". */
  readonly line: string;
}

/**
 * Who waits for a task and what else each still waits for, as the task's review page lists them:
 * its unfinished dependents, grouped by their other dependencies not yet delivered, in the order
 * the dependencies list them. The task itself is taken as delivered: this is what its handoff
 * unblocks. Empty with no dependents (or with the dependencies plugin off).
 */
export function dependentsReadiness(
  snapshot: PeerDependencySnapshot | undefined,
  project: string,
  task: string,
  index: DependencyIndex,
  facts: ReadinessFacts,
): ReadonlyArray<DependentsGroup> {
  const groups = new Map<string, { dependents: PeerTask[]; waitingOn: ReadinessRow[] }>();
  for (const dependent of neededBy(snapshot, project, task, index)) {
    if (dependent.state === "done") continue;
    const waitingOn = dependenciesOf(snapshot, project, dependent.task.id, index)
      .filter((item) => item.task.id !== task)
      .map((item) => readinessRow(item, facts))
      .filter((row) => row.readiness === "waiting");
    const key = waitingOn.map((row) => row.task.id).join("\n");
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { dependents: [dependent.task], waitingOn });
    else group.dependents.push(dependent.task);
  }
  return [...groups.values()].map(({ dependents, waitingOn }) => ({
    dependents,
    waitingOn,
    line: `${dependents.map(dependencyName).join(", ")} · ${readyWhenLine(waitingOn)}`,
  }));
}
