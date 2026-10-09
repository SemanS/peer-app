import { STALE_INPUT_WAIT_MS, type PeerStaleInput } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

type Entry = { since: number; nextAt: number; checked: boolean; scopes: PeerStaleInput["scopes"] };
/** A refusal signal, not a scan of every session's input ledger. It never stores input text. */
export class Refusals {
  readonly entries = new Map<string, Entry>();
  readonly bound: number;
  constructor(bound = 200) {
    this.bound = bound;
  }
  get size() {
    return this.entries.size;
  }
  record(session: string, scopes: PeerStaleInput["scopes"], now: number) {
    if (scopes.length === 0) {
      this.end(session);
      return;
    }
    const old = this.entries.get(session);
    this.entries.set(session, {
      since: old?.since ?? now,
      nextAt: old?.nextAt ?? now + STALE_INPUT_WAIT_MS,
      checked: old?.checked ?? false,
      scopes: scopes.map(({ scope, readVersion, currentVersion }) => ({
        scope,
        readVersion,
        currentVersion,
      })),
    });
    while (this.entries.size > this.bound) this.entries.delete(this.entries.keys().next().value!);
  }
  end(session: string) {
    this.entries.delete(session);
  }
  clear() {
    this.entries.clear();
  }
  list(now: number): ReadonlyArray<PeerStaleInput> {
    return [...this.entries]
      .filter(
        ([, entry]) =>
          entry.checked &&
          now - entry.since >= STALE_INPUT_WAIT_MS &&
          now - entry.since < 86_400_000,
      )
      .map(([session, entry]) => ({
        session,
        since: DateTime.formatIso(DateTime.makeUnsafe(entry.since)),
        scopes: entry.scopes,
      }));
  }
  nextWake(now: number): number | null {
    const times = [...this.entries.values()].map((e) =>
      Math.max(now, Math.min(e.nextAt, e.since + 86_400_000)),
    );
    return times.length === 0 ? null : Math.min(...times);
  }
  async refresh(
    now: number,
    live: ReadonlySet<string>,
    read: (session: string) => Promise<PeerStaleInput["scopes"]>,
  ) {
    const pending = [...this.entries];
    for (let start = 0; start < pending.length; start += 4) {
      await Promise.all(
        pending.slice(start, start + 4).map(async ([session, entry]) => {
          if (this.entries.get(session) !== entry) return;
          if (!live.has(session) || now - entry.since >= 86_400_000) {
            this.end(session);
            return;
          }
          if (now < entry.nextAt) return;
          try {
            const scopes = await read(session);
            if (this.entries.get(session) !== entry) return;
            if (scopes.length === 0) {
              this.end(session);
              return;
            }
            entry.scopes = scopes.map(({ scope, readVersion, currentVersion }) => ({
              scope,
              readVersion,
              currentVersion,
            }));
          } catch {
            /* A failed recheck keeps the known refusal, with a bounded retry. */
          }
          if (this.entries.get(session) === entry) {
            entry.checked = true;
            entry.nextAt = now + STALE_INPUT_WAIT_MS;
          }
        }),
      );
    }
  }
}
