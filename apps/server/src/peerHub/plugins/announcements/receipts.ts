import type { PeerAnnouncementReceipt } from "@t3tools/contracts";
type Queued = PeerAnnouncementReceipt & { readonly workspace: string };
export function makeOutbox() {
  const queue = new Map<string, Queued>();
  let nextAt = Infinity;
  let failures = 0;
  const key = (row: Queued) =>
    [row.workspace, row.project, row.announcement, row.session, row.state].join("/");
  return {
    add(row: Queued, now: number) {
      if (queue.size === 0) nextAt = now + 2000;
      queue.set(key(row), row);
      while (queue.size > 500) queue.delete(queue.keys().next().value!);
    },
    batch: (workspace: string) =>
      [...queue.values()].filter((row) => row.workspace === workspace).slice(0, 100),
    due: (now: number) => queue.size > 0 && now >= nextAt,
    size: () => queue.size,
    workspaces: () => [...new Set([...queue.values()].map((row) => row.workspace))],
    accepted(batch: ReadonlyArray<Queued>, now: number) {
      for (const row of batch) if (queue.get(key(row)) === row) queue.delete(key(row));
      failures = 0;
      nextAt = queue.size === 0 ? Infinity : now + 2000;
    },
    failed(now: number) {
      nextAt = now + [10000, 30000, 60000][Math.min(failures++, 2)]!;
    },
    forget(workspaces: ReadonlySet<string>) {
      for (const [id, row] of queue) if (!workspaces.has(row.workspace)) queue.delete(id);
      if (queue.size === 0) nextAt = Infinity;
    },
  };
}
