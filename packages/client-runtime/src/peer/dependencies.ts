import {
  WS_METHODS,
  dependencyState,
  type PeerDependencySnapshot,
  type PeerTask,
  type PeerWorkThread,
} from "@t3tools/contracts";
import type { Atom } from "effect/unstable/reactivity";
import type * as EnvironmentRegistry from "../connection/registry.ts";
import { createEnvironmentRpcCommand } from "../state/runtime.ts";
export function createPeerDependencyAtoms<R, ER>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, ER>,
) {
  return {
    peerDependenciesChange: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer:dependencies:change",
      tag: WS_METHODS.peerDependenciesChange,
    }),
  };
}
/** Built once for a project's render pass and shared by all its rows. */
export function dependencyIndex(
  tasks: ReadonlyArray<PeerTask>,
  threads: ReadonlyArray<PeerWorkThread>,
) {
  const byTask = new Map<string, PeerWorkThread[]>();
  for (const thread of threads) {
    if (!thread.task) continue;
    const list = byTask.get(thread.task) ?? [];
    list.push(thread);
    byTask.set(thread.task, list);
  }
  return new Map(
    tasks.map((task) => [
      task.id,
      { task, state: dependencyState(task, byTask.get(task.id) ?? []) },
    ]),
  );
}
export type DependencyIndex = ReturnType<typeof dependencyIndex>;
export const stateWord = (state: string) =>
  state === "review" ? "in review" : state === "done" ? "closed" : state;
export function dependenciesOf(
  snapshot: PeerDependencySnapshot | undefined,
  project: string,
  task: string,
  index: DependencyIndex,
) {
  return snapshot?.available
    ? (snapshot.projects[project]?.[task] ?? []).flatMap((id) => {
        const found = index.get(id);
        return found ? [found] : [];
      })
    : [];
}
export function neededBy(
  snapshot: PeerDependencySnapshot | undefined,
  project: string,
  task: string,
  index: DependencyIndex,
) {
  return snapshot?.available
    ? Object.entries(snapshot.projects[project] ?? {})
        .filter(([, on]) => on.includes(task))
        .flatMap(([id]) => {
          const found = index.get(id);
          return found ? [found] : [];
        })
    : [];
}
export function blockers(
  snapshot: PeerDependencySnapshot | undefined,
  project: string,
  task: string,
  index: DependencyIndex,
) {
  return index.get(task)?.state === "done"
    ? []
    : dependenciesOf(snapshot, project, task, index).filter(
        (item) => item.state === "open" || item.state === "review",
      );
}
export function candidates(
  snapshot: PeerDependencySnapshot | undefined,
  project: string,
  task: string,
  index: DependencyIndex,
) {
  const selected = new Set(snapshot?.projects[project]?.[task] ?? []);
  return snapshot?.available
    ? [...index.values()]
        .filter(
          ({ task: other }) =>
            other.id !== task && (other.status !== "done" || selected.has(other.id)),
        )
        .map((item) => ({ ...item, checked: selected.has(item.task.id) }))
    : [];
}
export const dependencyName = (task: Pick<PeerTask, "key" | "id">) => task.key ?? task.id;
export const blockedLabel = (items: ReadonlyArray<{ task: PeerTask }>) =>
  items.length
    ? `Blocked by ${dependencyName(items[0]!.task)}${items.length > 1 ? ` +${items.length - 1}` : ""}`
    : null;
export const cycleSentence = (path: ReadonlyArray<string>, index: DependencyIndex) =>
  `A cycle cannot be recorded: ${path
    .map((id) => {
      const task = index.get(id)?.task;
      return task ? dependencyName(task) : id;
    })
    .join(" → ")}.`;
const projectIndexes = new WeakMap<object, DependencyIndex>();
export function projectDependencyIndex(project: {
  readonly work: {
    readonly tasks: ReadonlyArray<PeerTask>;
    readonly threads: ReadonlyArray<PeerWorkThread>;
  };
}) {
  let index = projectIndexes.get(project);
  if (!index) {
    index = dependencyIndex(project.work.tasks, project.work.threads);
    projectIndexes.set(project, index);
  }
  return index;
}
