import * as Effect from "effect/Effect";
import type { createGit, Repository } from "./git.ts";
import { SHARE_GAP_MS } from "./limits.ts";

export type Want = { repository: Repository; branch: string; commit: string };
type Entry = Want & { pushed?: string | undefined; at: number };

/**
 * Work in progress shared as `refs/peer/wip/<bookmark>` on origin, one per agent session of a
 * Jujutsu checkout. Each round says what should be shared now; this pushes what is new (at most
 * every two minutes per ref) and deletes what is no longer wanted: the session ended, its
 * bookmark landed, or sharing was turned off. jj never imports these refs as bookmarks.
 */
export function makeShare(
  git: ReturnType<typeof createGit>,
  log: (event: string, fields: Readonly<Record<string, unknown>>) => Effect.Effect<void>,
) {
  const entries = new Map<string, Entry>();
  return {
    apply: (wanted: ReadonlyMap<string, Want>, now: number, prune = true) =>
      Effect.gen(function* () {
        let pushed = 0,
          refused = 0;
        for (const [key, want] of wanted) {
          const known = entries.get(key);
          if (known?.pushed === want.commit) continue;
          if (known !== undefined && now - known.at < SHARE_GAP_MS) continue;
          const done = yield* git.pushWip(want.repository, want.branch, want.commit);
          entries.set(key, { ...want, pushed: done ? want.commit : known?.pushed, at: now });
          if (done) pushed++;
          else refused++;
        }
        if (prune)
          for (const [key, entry] of entries)
            if (!wanted.has(key)) {
              // A ref never pushed has nothing to delete; a failed delete is tried again.
              if (
                entry.pushed === undefined ||
                (yield* git.pushWip(entry.repository, entry.branch))
              )
                entries.delete(key);
            }
        if (pushed + refused > 0)
          yield* log("forecast.shared", {
            refs: pushed + refused,
            outcome: refused > 0 ? "refused" : "pushed",
          });
      }),
  };
}
