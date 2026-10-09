import {
  dependencyState,
  type PeerDependencySnapshot,
  type PeerTask,
  type PeerWorkThread,
} from "@t3tools/contracts";
export interface Fact {
  readonly id: string;
  readonly name: string;
  readonly state: string;
  readonly version: number;
}
/** Agent text carries only handles, never a teammate's title or shared prose. */
const handle = (task: PeerTask) =>
  (task.key ?? task.id)
    .replace(/[^\p{L}\p{N}._-]/gu, " ")
    .trim()
    .slice(0, 60) || task.id;
export function facts(
  snapshot: PeerDependencySnapshot | undefined,
  project: string,
  task: string,
  tasks: ReadonlyArray<PeerTask>,
  threads: ReadonlyArray<PeerWorkThread>,
  contexts: ReadonlyArray<{
    readonly project: string;
    readonly scope: string;
    readonly version: number;
  }>,
) {
  if (!snapshot?.available) return { on: [], needed: [] } as { on: Fact[]; needed: Fact[] };
  const byTask = new Map<string, PeerWorkThread[]>();
  for (const thread of threads) {
    if (!thread.task) continue;
    const list = byTask.get(thread.task) ?? [];
    list.push(thread);
    byTask.set(thread.task, list);
  }
  const make = (id: string): Fact[] => {
    const found = tasks.find((t) => t.id === id);
    return found
      ? [
          {
            id,
            name: handle(found),
            state: dependencyState(found, byTask.get(id) ?? []),
            version:
              contexts.find((c) => c.project === project && c.scope === `task:${id}`)?.version ?? 0,
          },
        ]
      : [];
  };
  const rows = snapshot.projects[project] ?? {};
  return {
    on: (rows[task] ?? []).flatMap(make),
    needed: Object.entries(rows)
      .filter(([, on]) => on.includes(task))
      .flatMap(([id]) => make(id)),
  };
}
