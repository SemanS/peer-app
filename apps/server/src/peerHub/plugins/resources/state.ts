import type { PeerHeldResource, PeerResourcesList } from "@t3tools/contracts";
interface Entry {
  answer?: PeerResourcesList | undefined;
  offset: number;
  due?: number | undefined;
  unsupportedUntil: number;
  checkedExpiry?: string | undefined;
}
export const scopeKey = (hold: Pick<PeerHeldResource, "kind" | "name">) =>
  `${hold.kind}:${hold.name}`;
export function makeState(now: () => number) {
  const entries = new Map<string, Entry>();
  let allowed: ReadonlySet<string> | undefined;
  const entry = (workspace: string) => {
    let e = entries.get(workspace);
    if (!e) {
      e = { offset: 0, unsupportedUntil: 0 };
      entries.set(workspace, e);
    }
    return e;
  };
  const read = (workspace: string) => entries.get(workspace)?.answer;
  const hubNow = (workspace: string) => now() + (entries.get(workspace)?.offset ?? 0);
  return {
    read,
    hubNow,
    supported: (workspace: string) => (entries.get(workspace)?.unsupportedUntil ?? 0) <= now(),
    queue: (workspace: string, delay = 250) => {
      if (allowed !== undefined && !allowed.has(workspace)) return;
      const e = entry(workspace);
      e.due ??= now() + delay;
    },
    due: () =>
      [...entries].flatMap(([workspace, e]) => {
        if (e.unsupportedUntil > now()) return [];
        const expired = e.answer?.held
          .filter((h) => Date.parse(h.expiresAt) <= hubNow(workspace))
          .map((h) => `${scopeKey(h)}:${h.expiresAt}`)
          .sort()
          .join("|");
        if ((e.due !== undefined && e.due <= now()) || (expired && expired !== e.checkedExpiry)) {
          e.due = undefined;
          e.checkedExpiry = expired;
          return [workspace];
        }
        return [];
      }),
    accept: (workspace: string, answer: PeerResourcesList) => {
      if (allowed !== undefined && !allowed.has(workspace)) return false;
      const e = entry(workspace);
      e.offset = Date.parse(answer.at) - now();
      e.unsupportedUntil = 0;
      const changed =
        JSON.stringify([e.answer?.held, e.answer?.patterns]) !==
        JSON.stringify([answer.held, answer.patterns]);
      if (changed) e.answer = answer;
      return changed;
    },
    unsupported: (workspace: string) => {
      if (allowed !== undefined && !allowed.has(workspace)) return;
      const e = entry(workspace);
      e.answer = undefined;
      e.unsupportedUntil = now() + 600_000;
    },
    own: (workspace: string, hold: PeerHeldResource, at: string, released = false) => {
      if (allowed !== undefined && !allowed.has(workspace)) return;
      const e = entry(workspace);
      e.offset = Date.parse(at) - now();
      const held = (e.answer?.held ?? []).filter(
        (h) => h.project !== hold.project || scopeKey(h) !== scopeKey(hold),
      );
      e.answer = {
        held: released ? held : [...held, hold],
        patterns: e.answer?.patterns ?? {},
        at,
      };
    },
    forget: (workspaces: ReadonlyArray<string>) => {
      allowed = new Set(workspaces);
      for (const workspace of entries.keys())
        if (!allowed.has(workspace)) entries.delete(workspace);
    },
    entries: () => [...entries],
  };
}
