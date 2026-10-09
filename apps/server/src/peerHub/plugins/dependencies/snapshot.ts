import type { PeerDependencySnapshot } from "@t3tools/contracts";
export const LEGACY_MS = 10 * 60 * 1000;
/** A failed read never replaces facts or restarts the legacy probe window. */
export class Snapshots {
  readonly values = new Map<string, PeerDependencySnapshot>();
  private readonly checked = new Map<string, number>();
  restart() {
    this.checked.clear();
  }
  due(workspace: string, now: number) {
    return (
      this.values.get(workspace)?.available !== false ||
      !this.checked.has(workspace) ||
      now - (this.checked.get(workspace) ?? 0) >= LEGACY_MS
    );
  }
  put(value: PeerDependencySnapshot, now: number) {
    this.checked.set(value.workspace, now);
    const differs = JSON.stringify(this.values.get(value.workspace)) !== JSON.stringify(value);
    this.values.set(value.workspace, value);
    return differs;
  }
  hasEdges(workspace: string) {
    return Object.values(this.values.get(workspace)?.projects ?? {}).some((rows) =>
      Object.values(rows).some((on) => on.length),
    );
  }
  clean(workspaces: ReadonlyArray<string>) {
    for (const key of this.values.keys())
      if (!workspaces.includes(key)) {
        this.values.delete(key);
        this.checked.delete(key);
      }
  }
  forget(workspace: string) {
    this.values.delete(workspace);
    this.checked.delete(workspace);
  }
  apply(workspace: string, project: string, task: string, on: ReadonlyArray<string>, now: number) {
    const old = this.values.get(workspace);
    const rows = { ...old?.projects[project] };
    if (on.length) rows[task] = [...on];
    else delete rows[task];
    const projects = { ...old?.projects };
    if (Object.keys(rows).length) projects[project] = rows;
    else delete projects[project];
    return this.put({ workspace, available: true, projects }, now);
  }
}
