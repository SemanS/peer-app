export function createSchedule() {
  const queue = new Map<string, number>(),
    last = new Map<string, number>();
  return {
    trigger: (id: string, now: number) => {
      queue.set(id, now + 5000);
    },
    carry: (id: string, now: number) => {
      queue.delete(id);
      queue.set(id, Math.max(now + 20_000, (last.get(id) ?? 0) + 20_000));
    },
    next: (now: number, eligible: (id: string) => boolean) => {
      for (const [id, due] of queue)
        if (due <= now && now >= (last.get(id) ?? -20_000) + 20_000 && eligible(id)) {
          queue.delete(id);
          last.set(id, now);
          return id;
        }
      return undefined;
    },
    forget: (ids: Set<string>) => {
      for (const id of queue.keys()) if (!ids.has(id)) queue.delete(id);
      for (const id of last.keys()) if (!ids.has(id)) last.delete(id);
    },
    clear: () => {
      queue.clear();
      last.clear();
    },
  };
}
export class BudgetExceeded extends Error {
  constructor() {
    super("impact check budget exhausted");
  }
}
export function createBudget(now = () => performance.now()) {
  const started = now(),
    counts = { codegraph: 0, git: 0 };
  return {
    take: (kind: keyof typeof counts) => {
      if (now() - started >= 5000 || counts[kind] >= (kind === "git" ? 3 : 16))
        throw new BudgetExceeded();
      counts[kind]++;
    },
    counts,
  };
}
