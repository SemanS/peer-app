// @effect-diagnostics nodeBuiltinImport:off - checks that a recorded workspace is still on disk.
/**
 * Jujutsu workspaces: what Peer does for an agent in a colocated jj repository. It writes the agent
 * workspace's jj configuration (its name in the operation log, `auto-update-stale`, read-only aliases
 * for the other agents' changes), snapshots after every tool step, merges the versions a rewrite in
 * another workspace left, and says once whose change an agent named. It is local: no Hub feature, no
 * Hub. A Git checkout meets none of it.
 *
 * `afterStep` is one ordered pipeline. Following (fetch, then move onto what moved) belongs after the
 * snapshot and converge and before the notices: it rewrites the session's own change, so it runs only
 * while the agent waits for the hook, never in the background.
 *
 * @module peerHub/plugins/jujutsu/Jujutsu
 */
import * as NodeFS from "node:fs";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { PeerHubError, type JujutsuSettings, type JujutsuState } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";

import { VcsProcess, layer as vcsLayer } from "../../../vcs/VcsProcess.ts";
import * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import {
  jjInvocations,
  type PeerLifecycleEvent,
  type PeerSessionView,
  type PeerToolContext,
} from "../../core/plugin.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import * as PeerWork from "../../core/work/PeerWork.ts";
import { jjAvailability } from "../../core/vcs.ts";
import { OWN_KEYS, PROTECTION_KEYS, operationName, protectionKeys, remember } from "./config.ts";
import { makeJj, type Working } from "./client/jj.ts";
import { makeFollowing } from "./follow.ts";
import { makeOperationsApi } from "./operations.ts";
import { makePlaces, othersIds, type Found, type Workspace } from "./places.ts";
import { convergedNotice, protectedNotice, twoVersionsNotice } from "./text.ts";
import { judge, named } from "./verdicts.ts";

/** `PEER_JUJUTSU=off` keeps the plugin off on this computer, whatever its owner chose in Settings. */
export const forcedOff = () => process.env.PEER_JUJUTSU === "off";

/** Most of a hook's time a snapshot may take (design D3). */
const SNAPSHOT_MS = 2_000;
/** Aliases are rewritten this long after a workspace's `mine` last changed. */
const DEBOUNCE_MS = 2_000;
/** How often jj is probed and workspaces that are gone or landed are swept. */
const SWEEP_MS = 60_000;

/** What identifies the agent behind a workspace: a session, or a task checkout just made for one. */
interface Subject {
  readonly workspace: string;
  readonly project: string;
  readonly task: string | undefined;
  readonly branch?: string | undefined;
  readonly agent: string;
}

type Created = Extract<PeerLifecycleEvent, { readonly kind: "task-worktree-created" }>;

export const makeJujutsu = (options: { readonly debounceMs?: number } = {}) =>
  Effect.gen(function* () {
    const state = yield* PeerState.PeerState;
    const agents = yield* PeerAgents.PeerAgents;
    const work = yield* PeerWork.PeerWork;
    const places = makePlaces(makeJj(yield* VcsProcess), state, agents, work);
    const { jj, read, write, update, placeOf, taskKey, othersOf, hereOf, log } = places;
    let protection = (yield* read).protection !== false;

    /** root → key → the value Peer last wrote, so an unchanged alias is not written again. */
    const written = new Map<string, Map<string, string>>();
    const dirty = new Set<string>();
    const wake = yield* Queue.dropping<void>(1);
    const launched = yield* Queue.unbounded<Created>();
    let probe: Omit<JujutsuState, "agentWorkspaces" | "protection"> = { connection: "connected" };

    const following = makeFollowing(places);
    const operations = makeOperationsApi(places);

    /** Writes a workspace's keys as its record says; the aliases only while protection is on, each whole. */
    const render = (root: string) =>
      Effect.gen(function* () {
        const data = yield* read;
        const one = data.workspaces[root];
        if (one === undefined || !one.configured) return;
        const known = written.get(root) ?? new Map<string, string>();
        written.set(root, known);
        const fresh = yield* jj.apply(one.repo, root, {
          keys: [
            ["operation.username", operationName(one.email, one.agent)],
            ["snapshot.auto-update-stale", "true"],
            ...(protection ? protectionKeys(one.mine, othersIds(data, root, one.repo)) : []),
          ],
          user: [
            ["user.name", one.name],
            ["user.email", one.email],
          ],
          ours: one.keys,
          known,
        });
        if (fresh.length > 0)
          yield* update(root, (current) => ({ ...current, keys: [...current.keys, ...fresh] }));
      });

    const touched = (repo: string) =>
      Effect.sync(() => dirty.add(repo)).pipe(Effect.andThen(Queue.offer(wake, undefined)));

    /** The aliases of every workspace of the repositories whose `mine` moved. */
    const flush = Effect.gen(function* () {
      const repos = new Set(dirty);
      dirty.clear();
      for (const [root, one] of Object.entries((yield* read).workspaces))
        if (repos.has(one.repo)) yield* render(root);
    });

    /** Remembers an agent's workspace, and its working-copy change as its own once it has content. */
    const record = (subject: Subject, found: Found, working: Working | null) =>
      Effect.gen(function* () {
        const email = yield* state.email;
        if (email === null) return;
        const before = (yield* read).workspaces[found.root];
        const mine =
          working === null || working.blank
            ? (before?.mine ?? [])
            : remember(before?.mine ?? [], working.id);
        const next: Workspace = {
          repo: found.repo,
          configured: found.own,
          email,
          name: state.nameOf(subject.workspace, email),
          agent: subject.agent,
          task: yield* taskKey(subject.workspace, subject.project, subject.task),
          bookmark: subject.branch,
          mine,
          keys: before?.keys ?? [],
        };
        const sig = (one: Workspace) => [one.agent, one.task, one.bookmark, ...one.mine].join("\0");
        if (before !== undefined && sig(before) === sig(next)) return;
        yield* write((now) => ({ ...now, workspaces: { ...now.workspaces, [found.root]: next } }));
        if (before?.mine.join() !== mine.join()) yield* touched(found.repo);
      });

    /**
     * After a tool step: the one ordered pipeline (see the module note). A snapshot that misses its
     * time is logged and the step goes on; the next step snapshots again.
     */
    const afterStep = (ctx: PeerToolContext) =>
      Effect.gen(function* () {
        const found = yield* placeOf(ctx.session.cwd);
        const here = hereOf(ctx.session);
        here.jj = found !== null;
        if (found === null) return null;
        const texts: Array<string> = [];
        const told = ctx.session.told?.("jujutsu") ?? new Set<string>();
        const started = yield* Clock.currentTimeMillis;
        const left = () =>
          Clock.currentTimeMillis.pipe(Effect.map((now) => ctx.remainingMs - now + started));
        const fields = { session: ctx.session.id };

        // 1. Snapshot, before another workspace's rewrite can overtake an edit jj has not seen.
        const snapped = yield* jj.snapshot(
          found.repo,
          found.root,
          Math.min(SNAPSHOT_MS, ctx.remainingMs),
        );
        const ms = (yield* Clock.currentTimeMillis) - started;
        if (snapped.late) yield* log("jujutsu.snapshot.late", { ...fields, ms });
        else {
          const working = yield* jj.working(found.repo, found.root);
          yield* log("jujutsu.snapshot", {
            ...fields,
            ms,
            changed: working?.commit !== here.commit,
          });
          here.commit = working?.commit;
          yield* record(ctx.session, found, working);

          // 2. Versions a rewrite overtook are merged; 3. what jj could not choose is left, and told.
          if ((yield* left()) > 300) {
            const mergeStart = yield* Clock.currentTimeMillis;
            const merged = yield* jj.converge(found.repo, found.root, (yield* left()) - 200);
            const solved = merged.found.filter((id) => !merged.still.includes(id));
            if (merged.found.length > 0)
              yield* log("jujutsu.converged", {
                ...fields,
                changes: merged.found.length,
                ms: (yield* Clock.currentTimeMillis) - mergeStart,
                outcome: solved.length > 0 ? "done" : "refused",
              });
            if (solved[0] !== undefined) texts.push(convergedNotice(solved[0]));
            for (const id of solved) {
              here.twoVersions.delete(id);
              told.delete(`two:${id}`);
            }
            for (const id of merged.still) {
              here.twoVersions.add(id);
              if (!told.has(`two:${id}`)) texts.push(twoVersionsNotice(id));
              told.add(`two:${id}`);
            }
          }
          // 4. Following: the fetch of what the work builds on, the move onto it, and what moved.
          yield* following.step(ctx.session, found, texts, left);
        }

        // 5. Notices: whose change the command named, once per change.
        if (protection && ctx.command !== undefined) {
          here.others = yield* othersOf(ctx.session, found);
          for (const hit of named(jjInvocations(ctx.command), here.others)) {
            if (told.has(`named:${hit.key}`)) continue;
            told.add(`named:${hit.key}`);
            const text = protectedNotice(hit.word, hit.owner);
            texts.push(text);
            yield* log("jujutsu.told", { ...fields, kind: "protected", chars: text.length });
          }
        }
        texts.push(...operations.undone(ctx.session.id));
        return texts.length === 0 ? null : texts.join("\n\n").slice(0, 1_200);
      });

    const sessionStart = (session: PeerSessionView) =>
      Effect.gen(function* () {
        const found = yield* placeOf(session.cwd);
        const here = hereOf(session);
        here.jj = found !== null;
        if (found === null) return;
        yield* record(session, found, null);
        here.others = yield* othersOf(session, found);
        yield* render(found.root);
      });

    /** The stop of `--ignore-immutable`, decided with fresh knowledge and no state changed. */
    const stopFor = (ctx: PeerToolContext) =>
      Effect.gen(function* () {
        const found = yield* placeOf(ctx.session.cwd);
        const others = found === null ? [] : yield* othersOf(ctx.session, found);
        const verdict = judge(ctx, { jj: found !== null, others }, protection);
        if (verdict !== null)
          yield* log("jujutsu.stopped", {
            session: ctx.session.id,
            named: verdict.reason.includes("would rewrite"),
          });
        return verdict;
      });

    /** A herdr task's workspace is configured when it is made, before its agent's first step. */
    const onCreated = (event: Created) =>
      Effect.gen(function* () {
        const found = yield* placeOf(event.root);
        if (found === null || !found.own) return;
        const thread = ((yield* work.localThreads).get(event.workspace) ?? []).find(
          (one) => one.id === event.thread,
        );
        yield* record(
          {
            workspace: event.workspace,
            project: event.project,
            task: event.task,
            branch: thread?.branch,
            agent: thread?.harness ?? "agent",
          },
          found,
          null,
        );
        yield* render(found.root);
      });

    /** Probes jj, forgets workspaces that are gone, and drops changes that landed from the aliases. */
    const sweep = Effect.gen(function* () {
      const available = yield* Effect.promise(() => jjAvailability());
      probe = {
        connection: available._tag === "available" ? "connected" : "notAvailable",
        ...(available._tag === "available" || available._tag === "unsupported-version"
          ? { version: available.version }
          : {}),
        ...(available._tag === "available"
          ? {}
          : { problem: available._tag === "missing" ? ("missing" as const) : ("tooOld" as const) }),
        checkedAt: DateTime.formatIso(DateTime.makeUnsafe(yield* Clock.currentTimeMillis)),
      };
      const data = yield* read;
      const present = Object.entries(data.workspaces).filter(([root]) => NodeFS.existsSync(root));
      const landed = new Set<string>();
      for (const repo of new Set(present.map(([, one]) => one.repo))) {
        const ids = present.flatMap(([, one]) => (one.repo === repo ? one.mine : []));
        if (ids.length > 0) for (const id of yield* jj.landed(repo, ids)) landed.add(id);
      }
      if (present.length < Object.keys(data.workspaces).length || landed.size > 0) {
        yield* write((now) => ({
          ...now,
          workspaces: Object.fromEntries(
            present.map(([root, one]) => [
              root,
              { ...one, mine: one.mine.filter((id) => !landed.has(id)) },
            ]),
          ),
        }));
        for (const repo of new Set(present.map(([, one]) => one.repo))) yield* touched(repo);
      }
    });

    const status = read.pipe(
      Effect.map((data): JujutsuState => ({
        ...probe,
        agentWorkspaces: Object.values(data.workspaces).filter((one) => one.configured).length,
        protection,
      })),
    );

    return {
      status,
      /** The change ids of this session that have two versions jj could not merge on its own. */
      twoVersions: (session: PeerSessionView): ReadonlyArray<string> => [
        ...hereOf(session).twoVersions,
      ],
      sessionStart,
      afterStep,
      ...following.api,
      ...operations.api,
      stopFor,
      stopFallback: (ctx: PeerToolContext) => judge(ctx, hereOf(ctx.session), protection),
      taskWorktreeCreated: (event: Created) => Queue.offer(launched, event).pipe(Effect.asVoid),
      /** Protection on or off for this computer's agent workspaces. */
      configure: (input: JujutsuSettings): Effect.Effect<JujutsuState, PeerHubError> =>
        Effect.gen(function* () {
          if (input.protection !== undefined && input.protection !== protection) {
            protection = input.protection;
            yield* write((now) => ({ ...now, protection }));
            for (const [root, one] of Object.entries((yield* read).workspaces))
              if (!one.configured) continue;
              else if (protection) yield* render(root);
              else yield* jj.unset(one.repo, root, PROTECTION_KEYS, written.get(root));
          }
          return yield* status;
        }),
      /** Removes the keys Peer wrote from every workspace it configured, and forgets them. */
      turnOff: Effect.gen(function* () {
        for (const [root, one] of Object.entries((yield* read).workspaces))
          if (one.configured) yield* jj.unset(one.repo, root, [...OWN_KEYS, ...one.keys]);
        written.clear();
        dirty.clear();
        yield* write((now) => ({ ...now, workspaces: {} }));
      }),
      run: Effect.all(
        [
          Effect.forever(Queue.take(launched).pipe(Effect.flatMap(onCreated), Effect.ignore)),
          Effect.forever(
            Queue.take(wake).pipe(
              Effect.andThen(Effect.sleep(options.debounceMs ?? DEBOUNCE_MS)),
              Effect.andThen(flush),
              Effect.ignore,
            ),
          ),
          Effect.forever(sweep.pipe(Effect.ignore, Effect.andThen(Effect.sleep(SWEEP_MS)))),
        ],
        { concurrency: "unbounded", discard: true },
      ),
      /** The debounced rewrite and the sweep, now: for tests. */
      flush,
      sweep,
    };
  });

export class Jujutsu extends Context.Service<
  Jujutsu,
  Effect.Success<ReturnType<typeof makeJujutsu>>
>()("t3/peerHub/plugins/jujutsu/Jujutsu") {}

export const layer = Layer.effect(Jujutsu, makeJujutsu()).pipe(
  Layer.provide(vcsLayer.pipe(Layer.provide(NodeServices.layer))),
);
