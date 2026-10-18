/**
 * Following a teammate's change (design D6): keeping the work current at tool steps, `peer follow`,
 * the moved notice, and the notice that a push carries a teammate's change. The decisions are here;
 * the jj calls and the bookkeeping over their answers are in `client/follow.ts`.
 *
 * @module peerHub/plugins/jujutsu/follow
 */
import { PeerHubError, type JujutsuFollowInput } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";

import {
  CliError,
  jjInvocations,
  refused,
  type PeerHookContext,
  type PeerSessionView,
  type PeerToolContext,
} from "../../core/plugin.ts";
import {
  dueBookmarks,
  keyOf,
  makeFollow,
  movesIn,
  ownedBy,
  pushedRange,
  type Built,
} from "./client/follow.ts";
import type { Found, Places } from "./places.ts";
import { movedNotice, pushNotice, whoseWork } from "./text.ts";

const FETCH_EVERY_MS = 30_000;
const NEEDS_JJ = "peer follow needs a Jujutsu checkout, and this is not one";
const NEVER = "keep working on your own change";
const short = (built: Built) => built.change.slice(0, 8);

export const makeFollowing = (deps: Places) => {
  const { jj, state, work, log } = deps;
  const follow = makeFollow(jj);
  const builtOn = (found: Found, within?: string) =>
    deps
      .ids(found)
      .pipe(
        Effect.flatMap((ids) =>
          follow.builtOn(found.repo, found.root, { ...ids, ...(within ? { within } : {}) }),
        ),
      );

  /** What moved under the session since it last heard: one text per move, said once. */
  const tellMoved = (session: PeerSessionView, found: Found, seen: ReadonlyArray<Built>) =>
    Effect.gen(function* () {
      const texts: Array<string> = [];
      for (const { built, was } of movesIn(session.told?.("jujutsu") ?? new Set(), seen)) {
        const { mine } = yield* deps.ids(found);
        const text = movedNotice({
          owner: ownedBy(yield* deps.othersOf(session, found), built)?.owner,
          change: short(built),
          from: was.slice(0, 8),
          ...(yield* follow.moved(found.repo, found.root, was, built.commit, mine)),
        });
        texts.push(text);
        yield* log("jujutsu.told", { session: session.id, kind: "moved", chars: text.length });
      }
      return texts;
    });

  /**
   * Step 4 of the hook, right after the snapshot: fetch what the work builds on when it is due
   * (at most every 30 s, three bookmarks), move the work onto a Git teammate's new tip, and tell
   * what moved.
   */
  const step = (
    session: PeerSessionView,
    found: Found,
    texts: Array<string>,
    left: () => Effect.Effect<number>,
  ) =>
    Effect.gen(function* () {
      const here = deps.hereOf(session);
      const now = yield* Clock.currentTimeMillis;
      let seen = yield* builtOn(found);
      // A bookmark is followed while a change it names is among the work's ancestors.
      const remember = () => {
        here.known.clear();
        for (const one of seen) if (one.bookmark) here.known.set(one.bookmark, one.commit);
      };
      remember();
      const due =
        now - here.fetchedAt < FETCH_EVERY_MS ? [] : dueBookmarks(here.known, here.fetched);
      if (due.length > 0) {
        const kept = yield* follow.keepCurrent(found.repo, found.root, {
          ...(yield* deps.ids(found)),
          due,
          known: new Map(here.known),
          left,
        });
        for (const { bookmark, ...done } of kept) {
          yield* log("jujutsu.followed", done);
          // A fetch that was skipped or timed out is not this step's fetch: the next step tries again.
          if (done.action === "fetch" && done.outcome !== "timeout" && bookmark !== undefined) {
            here.fetchedAt = now;
            here.fetched.set(bookmark, now);
          }
        }
        seen = yield* builtOn(found);
        remember();
      }
      texts.push(...(yield* tellMoved(session, found, seen)));
    });

  /** Another task's newest work with a bookmark: this computer's workspaces first, then the Hub's threads. */
  const candidate = (session: PeerSessionView, found: Found, wanted: string) =>
    Effect.gen(function* () {
      const task = (yield* work.tasks(session.workspace, session.project)).find(
        (one) => one.id === wanted || one.key?.toLowerCase() === wanted.toLowerCase(),
      );
      const key = task?.key ?? task?.id ?? wanted;
      const local = Object.entries((yield* deps.read).workspaces)
        .filter(([root, one]) => root !== found.root && one.repo === found.repo && one.bookmark)
        .filter(([, one]) => one.task === key || one.task === wanted)
        .map(([, one]) => ({ bookmark: one.bookmark!, person: one.name, harness: one.agent }));
      const remote = (yield* work.threads(session.workspace, session.project))
        .filter(
          (one) => task && one.task === task.id && one.branch && one.branch !== session.branch,
        )
        .toSorted((a, b) => b.seenAt.localeCompare(a.seenAt))
        .map((one) => ({
          bookmark: one.branch!,
          person: state.nameOf(session.workspace, one.email),
          harness: one.harness,
        }));
      const [first] = [...local, ...remote];
      return first && { ...first, key };
    });

  /** `peer follow <task>` or `--stop`: moves the session's own changes, and says where they are now. */
  const run = (session: PeerSessionView, input: { task?: string | undefined; stop?: boolean }) =>
    Effect.gen(function* () {
      const found = yield* deps.placeOf(session.cwd);
      if (found === null) return yield* Effect.fail(refused(NEEDS_JJ, NEVER));
      const one = input.stop ? undefined : yield* candidate(session, found, input.task ?? "");
      if (!input.stop && one === undefined)
        return yield* Effect.fail(
          refused(
            `${input.task} has no work with a bookmark yet`,
            "ask its agent: peer ask <task>",
          ),
        );
      const mine = (yield* deps.ids(found)).mine;
      const done = yield* follow.start(found.repo, found.root, { mine, bookmark: one?.bookmark });
      yield* log("jujutsu.followed", { action: one ? "follow" : "stop", outcome: done.outcome });
      if (!done.ok) return yield* Effect.fail(refused(done.error, NEVER));
      const told = session.told?.("jujutsu") ?? new Set<string>();
      const { known } = deps.hereOf(session);
      if (done.target === null) {
        for (const entry of told) if (entry.startsWith("moved:")) told.delete(entry);
        known.clear();
      } else {
        // What the command said is heard; the next step tells only a move after it.
        told.add(`moved:${keyOf(done.target)}:${done.target.commit}`);
        if (done.target.bookmark) known.set(done.target.bookmark, done.target.commit);
      }
      return {
        ...done,
        onto: done.target ? short(done.target) : undefined,
        person: one?.person,
        label: one && whoseWork({ person: one.person, task: one.key }, one.harness),
      };
    });

  /** `peer follow` with no argument: what the session builds on, and what moved since it last heard. */
  const status = (session: PeerSessionView) =>
    Effect.gen(function* () {
      const found = yield* deps.placeOf(session.cwd);
      if (found === null) return yield* Effect.fail(refused(NEEDS_JJ, NEVER));
      const seen = yield* builtOn(found);
      if (seen.length === 0) return "You build on no teammate's change.";
      const others = yield* deps.othersOf(session, found);
      const moved = yield* tellMoved(session, found, seen);
      const builds = seen.map((one) => {
        const owner = ownedBy(others, one)?.owner;
        return `You build on ${short(one)}${owner ? ` (${whoseWork(owner)})` : ""}.`;
      });
      return [
        ...builds,
        ...(moved.length === 0 ? ["Nothing moved since you last heard."] : moved),
      ].join("\n");
    });

  /**
   * The push notice, a landing message: the push carries a teammate's change that has not landed.
   * Said once per pushed bookmarks and base, in the stop of the push itself.
   */
  const pushed = (ctx: PeerHookContext | PeerToolContext) =>
    Effect.gen(function* () {
      const command = ctx.event === "pre-tool" && "command" in ctx ? ctx.command : undefined;
      const runs = jjInvocations(command ?? "").filter((one) => one.command === "jj git push");
      const found = runs.length === 0 ? null : yield* deps.placeOf(ctx.session.cwd);
      if (found === null) return null;
      const range = pushedRange(runs.flatMap((one) => one.args));
      const [first] = yield* builtOn(found, range.revset);
      const key = `push:${range.names.join(",")}:${first && keyOf(first)}`;
      const told = ctx.session.told?.("jujutsu");
      if (first === undefined || told?.has(key)) return null;
      told?.add(key);
      const other = ownedBy(yield* deps.othersOf(ctx.session, found), first);
      const text = pushNotice({
        task: (yield* deps.read).workspaces[found.root]?.task ?? ctx.session.task,
        change: short(first),
        other: other?.owner.task,
        bookmark: first.bookmark ?? other?.bookmark,
      });
      yield* log("jujutsu.told", { session: ctx.session.id, kind: "push", chars: text.length });
      return text;
    });

  /**
   * The agent session a web call names, by the work tree's id for its thread: `peer:<thread id>` for
   * a Peer thread, herdr's agent id for a herdr agent (`herdr:` and the session's own id, or its
   * terminal, which its pane tells).
   */
  const sessionOf = (input: JujutsuFollowInput) =>
    Effect.gen(function* () {
      const runtime = yield* deps.agents.runtimeAgents;
      const found = (yield* deps.agents.sessions).find(
        (one) =>
          one.workspace === input.workspace &&
          one.project === input.project &&
          (one.thread === input.session ||
            `herdr:${one.id}` === input.session ||
            runtime.some((row) => row.id === input.session && row.paneId === one.pane)),
      );
      return (
        found ??
        (yield* Effect.fail(new PeerHubError({ detail: "That agent is not running here." })))
      );
    });

  return {
    step,
    api: {
      followNow: run,
      followStatus: status,
      pushNotice: pushed,
      follow: (input: JujutsuFollowInput) =>
        sessionOf(input).pipe(
          Effect.flatMap((session) =>
            run(session, { task: input.task, stop: input.stop === true }),
          ),
          Effect.mapError((error) =>
            error instanceof CliError ? new PeerHubError({ detail: error.reason }) : error,
          ),
          Effect.map(({ change, onto, output, conflicts }) => ({
            change,
            ...(onto ? { onto } : {}),
            output,
            conflicts,
          })),
        ),
    },
  };
};
