/**
 * What a review session hears of itself (design D3): its role and limits at its start, and, after
 * a shell step, the files it changed where no edit hook looks, once each. A file it reverts leaves
 * the session's mark on the Hub's row (`changedFiles`) and may be told again if it changes again.
 * What it was told goes in `session.told("roles")`, which core keeps across Peer's restarts; a
 * compaction keeps it too, since the start block that follows says the role again and a change
 * already told is still in the agent's own transcript.
 *
 * @module peerHub/plugins/roles/tell
 */
import * as Effect from "effect/Effect";

import type { PeerHookContext, PeerToolContext } from "../../core/plugin.ts";
import type * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import { run } from "../../core/local.ts";
import { localOf, type Roles } from "./Roles.ts";
import { changedText, startBlock } from "./text.ts";

/** Which of `paths` git still sees changed in `root`; undefined when it cannot say. */
export type StillChanged = (
  root: string,
  paths: ReadonlyArray<string>,
) => Effect.Effect<ReadonlyArray<string> | undefined>;

export const gitStillChanged: StillChanged = (root, paths) =>
  Effect.tryPromise(() =>
    run("git", ["status", "--porcelain", "--untracked-files=all", "--", ...paths], {
      cwd: root,
      timeoutMs: 2000,
      raw: true,
    }),
  ).pipe(
    Effect.map((out) =>
      out
        .split("\n")
        .filter((line) => line.length > 3)
        .map((line) => line.slice(3).split(" -> ").at(-1)!.replace(/^"|"$/g, "")),
    ),
    Effect.orElseSucceed(() => undefined),
  );

/** Says `key` once: whether it was not said yet. */
const once = (told: Set<string>, key: string) => !told.has(key) && !!told.add(key);

export const tellings = (
  roles: Roles["Service"],
  agents: PeerAgents.PeerAgents["Service"],
  stillChanged: StillChanged = gitStillChanged,
) => ({
  /** A review session's start block; a session of a review thread takes its role on the Hub. */
  start: (ctx: PeerHookContext) =>
    Effect.gen(function* () {
      yield* roles.started(ctx.session);
      return roles.roleOf(ctx.session) === "review" ? startBlock() : null;
    }),
  /** After a shell step of a review session: the files it changed, told once, and the Hub's mark. */
  postTool: (ctx: PeerToolContext) =>
    Effect.gen(function* () {
      if (ctx.tool !== "Bash" || roles.roleOf(ctx.session) !== "review") return null;
      const own = localOf(ctx.session);
      const told = ctx.session.told?.("roles") ?? own.told;
      for (const path of ctx.paths) own.outstanding.add(path);
      if (own.outstanding.size > 0) {
        const still = yield* stillChanged(ctx.session.root, [...own.outstanding]);
        if (still !== undefined)
          for (const path of own.outstanding)
            if (!still.includes(path)) {
              own.outstanding.delete(path);
              told.delete(`changed:${path}`);
            }
      }
      const changed = own.outstanding.size > 0;
      if (changed !== own.flagged) {
        own.flagged = changed;
        yield* roles.markChanged(ctx.session, changed);
      }
      const fresh = [...own.outstanding].filter((path) => once(told, `changed:${path}`));
      if (fresh.length === 0) return null;
      yield* agents.log("roles.told", { session: ctx.session.id, files: fresh.length });
      return changedText(fresh);
    }),
});
