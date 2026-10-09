import { type PeerMetricsRow, type PeerMetricsTaskRow } from "@t3tools/contracts";
import type { LocalStore } from "./client/localStore.ts";
import { dayOf } from "./client/localStore.ts";
import { add, addTask, dedupe, foldEvent, init, sum, type MutableRow } from "./vocabulary.ts";
export function createCollector(
  store: LocalStore,
  now: () => number,
  failure: (where: "fold" | "flush") => void,
) {
  const days = new Map<
    string,
    {
      workspace: string;
      project: string;
      day: string;
      row: MutableRow;
      dirty: boolean;
      rev: number;
      seen: ReturnType<typeof dedupe>;
    }
  >();
  let lastFailure = -Infinity;
  const failed = (where: "fold" | "flush") => {
    if (now() - lastFailure >= 60000) {
      lastFailure = now();
      failure(where);
    }
  };
  const obtain = (workspace: string, project: string, day: string) => {
    if (!/^[A-Za-z0-9_-]+$/.test(workspace) || !/^[A-Za-z0-9_-]+$/.test(project))
      throw Error("invalid metrics ids");
    const key = `${workspace}/${project}/${day}`;
    let state = days.get(key);
    if (!state) {
      state = { workspace, project, day, row: init(), dirty: false, rev: 0, seen: dedupe() };
      days.set(key, state);
    }
    return state;
  };
  const touch = (s: ReturnType<typeof obtain>) => {
    s.dirty = true;
    s.rev = Math.max(now(), s.rev + 1);
  };
  return {
    async load() {
      for (const f of await store.files()) {
        const row = await store.read(f.workspace, f.project, f.day);
        if (row)
          obtain(f.workspace, f.project, f.day).row = {
            counters: { ...row.counters },
            durations: Object.fromEntries(
              Object.entries(row.durations).map(([k, v]) => [k, [...v]]),
            ),
            tasks: { ...row.tasks },
            ...(row.incomplete ? { incomplete: true } : {}),
          };
      }
    },
    record(e: Readonly<Record<string, unknown>>) {
      if (
        typeof e.workspace !== "string" ||
        typeof e.project !== "string" ||
        typeof e.t !== "string"
      )
        return;
      try {
        const s = obtain(e.workspace, e.project, dayOf(Date.parse(e.t)));
        const weight = () =>
          Object.values(s.row.counters).reduce((a, b) => a + b, 0) +
          Object.values(s.row.durations).reduce((a, h) => a + h.reduce((x, y) => x + y, 0), 0);
        const before = weight();
        foldEvent(s.row, e, s.seen);
        if (weight() !== before) touch(s);
      } catch {
        failed("fold");
      }
    },
    task(
      workspace: string,
      project: string,
      at: number,
      reference: string,
      row: PeerMetricsTaskRow,
    ) {
      const s = obtain(workspace, project, dayOf(at));
      addTask(s.row, reference, row);
      touch(s);
    },
    pr(workspace: string, project: string, checked: boolean, conflicting: boolean) {
      const s = obtain(workspace, project, dayOf(now()));
      if (checked) add(s.row, "pr.checked");
      if (conflicting) add(s.row, "pr.conflicting");
      touch(s);
    },
    snapshot(workspace: string, project: string, day: string): PeerMetricsRow {
      return { ...structuredClone(days.get(`${workspace}/${project}/${day}`)?.row ?? init()), day };
    },
    entries(workspace: string) {
      return [...days.values()]
        .filter((s) => s.workspace === workspace)
        .map((s) => ({ project: s.project, day: s.day, rev: s.rev, row: structuredClone(s.row) }))
        .sort((a, b) => a.day.localeCompare(b.day) || a.project.localeCompare(b.project));
    },
    range(workspace: string, project: string, from: string, to: string) {
      return [...days.values()]
        .filter(
          (s) => s.workspace === workspace && s.project === project && s.day >= from && s.day <= to,
        )
        .sort((a, b) => a.day.localeCompare(b.day))
        .map((s) => ({ ...structuredClone(s.row), day: s.day }));
    },
    sum(workspace: string, project: string, from: string, to: string) {
      return sum(this.range(workspace, project, from, to));
    },
    async flush() {
      for (const s of days.values())
        if (s.dirty) {
          const rev = s.rev;
          try {
            await store.save(s.workspace, s.project, s.day, {
              ...structuredClone(s.row),
              day: s.day,
            });
            if (s.rev === rev) s.dirty = false;
          } catch {
            failed("flush");
          }
        }
    },
    clear() {
      days.clear();
    },
  };
}
export type Collector = ReturnType<typeof createCollector>;
