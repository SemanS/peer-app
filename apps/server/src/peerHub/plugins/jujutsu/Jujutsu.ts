// @effect-diagnostics nodeBuiltinImport:off - checks that a recorded workspace is still on disk.
/**
 * Jujutsu workspaces: what Peer does for an agent that works in a colocated jj repository. It writes
 * the agent workspace's jj configuration (the agent's name in the operation log, `auto-update-stale`,
 * read-only aliases for the other agents' changes), snapshots the workspace after every tool step,
 * merges the versions a rewrite in another workspace left, and says once whose change an agent named.
 * Everything is local: the plugin has no Hub feature and needs no Hub. A Git checkout meets none of it.
 *
 * `afterStep` is one ordered pipeline: snapshot, divergence check, converge, then (following's, not
 * built here) the fetch and the move, then notices. Following belongs after the snapshot and before
 * the notices because it rewrites the session's own change, so it must run while the agent waits for
 * the hook.
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
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";

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
import { checkoutKind, jjAvailability } from "../../core/vcs.ts";
import {
  OWN_KEYS,
  PROTECTION_KEYS,
  operationName,
  protectionKeys,
  remember,
  union,
} from "./config.ts";
import { makeJj, type Working } from "./client/jj.ts";
import { convergedNotice, protectedNotice, twoVersionsNotice } from "./text.ts";
import { judge, named, type Other, type Place } from "./verdicts.ts";

/** `PEER_JUJUTSU=off` keeps the plugin off on this computer, whatever its owner chose in Settings. */
export const forcedOff = () => process.env.PEER_JUJUTSU === "off";

/** Most of a hook's time a snapshot may take (design D3). */
const SNAPSHOT_MS = 2_000;
/** Peer rewrites the aliases of a repository's workspaces this long after a `mine` last changed. */
const DEBOUNCE_MS = 2_000;
/** How often the probe of jj, and the sweep of workspaces that are gone or landed, run. */
const SWEEP_MS = 60_000;

/** What Peer keeps of one workspace an agent session worked in. */
const Workspace = Schema.Struct({
  /** The repository's default workspace: the workspaces that share aliases share this. */
  repo: Schema.String,
  /** False in the default workspace, where Peer writes no configuration. */
  configured: Schema.Boolean,
  email: Schema.String,
  name: Schema.String,
  agent: Schema.String,
  task: Schema.optional(Schema.String),
  bookmark: Schema.optional(Schema.String),
  /** The session's own changes, at most 200 (`MINE_MAX`). */
  mine: Schema.Array(Schema.String),
  /** The `user.*` keys Peer wrote because jj had none. */
  keys: Schema.Array(Schema.String),
});
type Workspace = typeof Workspace.Type;
/** Workspaces by their root. */
const Data = Schema.Struct({
  protection: Schema.optional(Schema.Boolean),
  workspaces: Schema.Record(Schema.String, Workspace),
});
type Data = typeof Data.Type;
const EMPTY: Data = { workspaces: {} };

/** A checkout this plugin works in. */
interface Found {
  readonly root: string;
  readonly repo: string;
  /** A workspace other than the repository's default. */
  readonly own: boolean;
}

/** What `session.local` keeps for the hook's fallback and the divergence it told. */
interface Here extends Place {
  twoVersions: Set<string>;
  commit: string | undefined;
}

const created = (event: PeerLifecycleEvent) =>
  event.kind === "task-worktree-created" ? event : undefined;
type Created = NonNullable<ReturnType<typeof created>>;

export const makeJujutsu = (options: { readonly debounceMs?: number } = {}) =>
  Effect.gen(function* () {
    const state = yield* PeerState.PeerState;
    const agents = yield* PeerAgents.PeerAgents;
    const work = yield* PeerWork.PeerWork;
    const jj = makeJj(yield* VcsProcess);
    const store = state.pluginData("jujutsu", Data);
    const read = store.read.pipe(Effect.map(Option.getOrElse(() => EMPTY)));
    const write = (change: (data: Data) => Data) =>
      store.update((now) => change(Option.getOrElse(now, () => EMPTY)));
    let protection = (yield* read).protection !== false;

    /** `root` → key → the value Peer last wrote, so an unchanged alias is not written again. */
    const written = new Map<string, Map<string, string>>();
    const dirty = new Set<string>();
    const wake = yield* Queue.dropping<void>(1);
    const launched = yield* Queue.unbounded<Created>();
    let probe: Pick<JujutsuState, "connection" | "problem" | "version"> & { checkedAt?: number } = {
      connection: "connected",
    };

    const placeOf = (cwd: string) =>
      Effect.tryPromise(() => checkoutKind(cwd)).pipe(
        Effect.map((kind): Found | null =>
          kind?.kind === "jj"
            ? { root: kind.root, repo: kind.mainRoot, own: kind.root !== kind.mainRoot }
            : null,
        ),
        Effect.orElseSucceed(() => null),
      );

    const who = (workspace: string) =>
      state.email.pipe(
        Effect.map((email) =>
          email === null ? null : { email, name: state.nameOf(workspace, email) },
        ),
      );

    /** The key people call a task by; the id when the Hub has no key for it. */
    const taskKey = (workspace: string, project: string, task: string | undefined) =>
      task === undefined
        ? Effect.succeed(undefined)
        : work.tasks(workspace, project).pipe(
            Effect.map((tasks) => {
              const found = tasks.find((one) => one.id === task || one.key === task);
              return found?.key ?? found?.id ?? task;
            }),
          );

    /** The changes of every other workspace of the repository, as the others' aliases hold them. */
    const othersIds = (data: Data, root: string, repo: string) => [
      ...new Set(
        Object.entries(data.workspaces).flatMap(([other, one]) =>
          other !== root && one.repo === repo ? one.mine : [],
        ),
      ),
    ];

    /** Other sessions' changes a command could name: this computer's workspaces and teammates' bookmarks. */
    const othersOf = (session: PeerSessionView, found: Found) =>
      Effect.gen(function* () {
        const data = yield* read;
        const local = Object.entries(data.workspaces)
          .filter(([root, one]) => root !== found.root && one.repo === found.repo)
          .map(([, one]): Other => ({
            ids: one.mine,
            bookmark: one.bookmark,
            owner: { person: one.name, task: one.task },
          }));
        const threads = yield* work.threads(session.workspace, session.project);
        const remote: Array<Other> = [];
        for (const thread of threads)
          if (thread.environment !== state.environmentId && thread.branch !== undefined)
            remote.push({
              ids: [],
              bookmark: thread.branch,
              owner: {
                person: state.nameOf(session.workspace, thread.email),
                task: yield* taskKey(session.workspace, session.project, thread.task),
              },
            });
        return [...local, ...remote];
      });

    const hereOf = (session: PeerSessionView) =>
      session.local<Here>("jujutsu", () => ({
        jj: false,
        others: [],
        twoVersions: new Set(),
        commit: undefined,
      }));

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
          yield* write((now) => {
            const current = now.workspaces[root];
            return current === undefined
              ? now
              : {
                  ...now,
                  workspaces: {
                    ...now.workspaces,
                    [root]: { ...current, keys: [...current.keys, ...fresh] },
                  },
                };
          }).pipe(Effect.ignore);
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

    /** Remembers a session's workspace, and its working-copy change as its own once it has content. */
    const record = (
      session: PeerSessionView,
      found: Found,
      working: Working | null,
      agent?: string,
    ) =>
      Effect.gen(function* () {
        const person = yield* who(session.workspace);
        if (person === null) return;
        const before = (yield* read).workspaces[found.root];
        const mine =
          working === null || working.blank
            ? (before?.mine ?? [])
            : remember(before?.mine ?? [], working.id);
        const next: Workspace = {
          repo: found.repo,
          configured: found.own,
          ...person,
          agent: agent ?? session.agent,
          task: yield* taskKey(session.workspace, session.project, session.task),
          bookmark: session.branch,
          mine,
          keys: before?.keys ?? [],
        };
        const sig = (one: Workspace) =>
          [
            one.configured,
            one.email,
            one.name,
            one.agent,
            one.task,
            one.bookmark,
            ...one.mine,
          ].join("\u0000");
        if (before !== undefined && sig(before) === sig(next)) return;
        yield* write((now) => ({
          ...now,
          workspaces: { ...now.workspaces, [found.root]: next },
        })).pipe(Effect.ignore);
        if (before === undefined || before.mine.join() !== mine.join()) yield* touched(found.repo);
      });

    const log = (event: string, fields: Readonly<Record<string, unknown>>) =>
      agents.log(event, fields);

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
        const started = yield* Clock.currentTimeMillis;
        const left = () =>
          Clock.currentTimeMillis.pipe(Effect.map((now) => ctx.remainingMs - (now - started)));

        // 1. Snapshot, before anyone else's rewrite can overtake an edit jj has not seen.
        const snapped = yield* jj.snapshot(
          found.repo,
          found.root,
          Math.min(SNAPSHOT_MS, ctx.remainingMs),
        );
        const ms = (yield* Clock.currentTimeMillis) - started;
        if (snapped.late) yield* log("jujutsu.snapshot.late", { session: ctx.session.id, ms });
        else {
          const working = yield* jj.working(found.repo, found.root);
          yield* log("jujutsu.snapshot", {
            session: ctx.session.id,
            ms,
            changed: working !== null && working.commit !== here.commit,
          });
          here.commit = working?.commit;
          yield* record(ctx.session, found, working);

          // 2. Versions a rewrite overtook, merged; 3. what jj could not choose is left and told.
          if ((yield* left()) > 300) {
            const mergeStart = yield* Clock.currentTimeMillis;
            const { found: two, still } = yield* jj.converge(
              found.repo,
              found.root,
              (yield* left()) - 200,
            );
            if (two.length > 0) {
              const solved = two.filter((id) => !still.includes(id));
              yield* log("jujutsu.converged", {
                session: ctx.session.id,
                changes: two.length,
                ms: (yield* Clock.currentTimeMillis) - mergeStart,
                outcome: solved.length > 0 ? "done" : "refused",
              });
              const told = ctx.session.told?.("jujutsu") ?? new Set<string>();
              for (const id of solved) {
                here.twoVersions.delete(id);
                told.delete(`two:${id}`);
              }
              if (solved[0] !== undefined) texts.push(convergedNotice(solved[0]));
              for (const id of still) {
                here.twoVersions.add(id);
                if (!told.has(`two:${id}`)) {
                  told.add(`two:${id}`);
                  texts.push(twoVersionsNotice(id));
                }
              }
            }
          }
          // 4. (Following: the fetch of what the work builds on, and the move onto it, go here.)
        }

        // 5. Notices: whose change the command named, once per change.
        const told = ctx.session.told?.("jujutsu");
        if (protection && told !== undefined && ctx.command !== undefined) {
          here.others = yield* othersOf(ctx.session, found);
          for (const hit of named(jjInvocations(ctx.command), here.others)) {
            if (told.has(`named:${hit.key}`)) continue;
            told.add(`named:${hit.key}`);
            const text = protectedNotice(hit.word, hit.owner);
            texts.push(text);
            yield* log("jujutsu.told", {
              session: ctx.session.id,
              kind: "protected",
              chars: text.length,
            });
          }
        }
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

    /** The stop of `--ignore-immutable`: decided with fresh knowledge, with no state changed. */
    const stopFor = (ctx: PeerToolContext) =>
      Effect.gen(function* () {
        const found = yield* placeOf(ctx.session.cwd);
        const others = found === null ? [] : yield* othersOf(ctx.session, found);
        const verdict = judge(ctx, { jj: found !== null, others }, protection);
        if (verdict !== null)
          yield* log("jujutsu.stopped", {
            session: ctx.session.id,
            named: others.length > 0 && verdict.reason.includes("would rewrite"),
          });
        return verdict;
      });
    const stopFallback = (ctx: PeerToolContext) => judge(ctx, hereOf(ctx.session), protection);

    /** A herdr task's workspace is configured when it is made, before its agent's first step. */
    const onCreated = (event: Created) =>
      Effect.gen(function* () {
        const found = yield* placeOf(event.root);
        const person = yield* who(event.workspace);
        if (found === null || !found.own || person === null) return;
        const thread = ((yield* work.localThreads).get(event.workspace) ?? []).find(
          (one) => one.id === event.thread,
        );
        const before = (yield* read).workspaces[found.root];
        const task = yield* taskKey(event.workspace, event.project, event.task);
        yield* write((now) => ({
          ...now,
          workspaces: {
            ...now.workspaces,
            [found.root]: {
              repo: found.repo,
              configured: true,
              ...person,
              agent: thread?.harness ?? "agent",
              task,
              bookmark: thread?.branch,
              mine: before?.mine ?? [],
              keys: before?.keys ?? [],
            },
          },
        })).pipe(Effect.ignore);
        yield* render(found.root);
      });

    /** Probes jj, forgets workspaces that are gone, and drops changes that landed from the aliases. */
    const sweep = Effect.gen(function* () {
      const available = yield* Effect.promise(() => jjAvailability());
      probe = {
        connection: available._tag === "available" ? "connected" : "notAvailable",
        ...(available._tag === "missing" ? { problem: "missing" as const } : {}),
        ...(available._tag === "unsupported-version" ? { problem: "tooOld" as const } : {}),
        ...(available._tag === "missing" ? {} : { version: available.version }),
        checkedAt: yield* Clock.currentTimeMillis,
      };
      const data = yield* read;
      const present = Object.entries(data.workspaces).filter(([root]) => NodeFS.existsSync(root));
      const repos = new Set(present.map(([, one]) => one.repo));
      const landed = new Set<string>();
      for (const repo of repos) {
        const ids = present.flatMap(([, one]) => (one.repo === repo ? one.mine : []));
        const live = ids.length === 0 ? null : yield* jj.inFlight(repo, repo, union(ids));
        if (live !== null) for (const id of ids) if (!live.includes(id)) landed.add(id);
      }
      if (present.length < Object.keys(data.workspaces).length || landed.size > 0) {
        yield* write((now) => ({
          ...now,
          workspaces: Object.fromEntries(
            Object.entries(now.workspaces)
              .filter(([root]) => NodeFS.existsSync(root))
              .map(([root, one]) => [
                root,
                { ...one, mine: one.mine.filter((id) => !landed.has(id)) },
              ]),
          ),
        })).pipe(Effect.ignore);
        for (const repo of repos) yield* touched(repo);
      }
    });

    const status = Effect.gen(function* () {
      const data = yield* read;
      return {
        connection: probe.connection,
        ...(probe.problem === undefined ? {} : { problem: probe.problem }),
        ...(probe.version === undefined ? {} : { version: probe.version }),
        agentWorkspaces: Object.values(data.workspaces).filter((one) => one.configured).length,
        protection,
        ...(probe.checkedAt === undefined
          ? {}
          : { checkedAt: DateTime.formatIso(DateTime.makeUnsafe(probe.checkedAt)) }),
      } satisfies JujutsuState;
    });

    return {
      status,
      /** The change ids of this session that have two versions jj could not merge on its own. */
      twoVersions: (session: PeerSessionView): ReadonlyArray<string> => [
        ...hereOf(session).twoVersions,
      ],
      sessionStart,
      afterStep,
      stopFor,
      stopFallback,
      taskWorktreeCreated: (event: Created) => Queue.offer(launched, event).pipe(Effect.asVoid),
      /** Protection on or off for this computer's agent workspaces. */
      configure: (input: JujutsuSettings): Effect.Effect<JujutsuState, PeerHubError> =>
        Effect.gen(function* () {
          if (input.protection !== undefined && input.protection !== protection) {
            protection = input.protection;
            yield* write((now) => ({ ...now, protection }));
            const data = yield* read;
            for (const [root, one] of Object.entries(data.workspaces)) {
              if (!one.configured) continue;
              if (protection) yield* render(root);
              else yield* jj.unset(one.repo, root, PROTECTION_KEYS, written.get(root));
            }
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
      /** Waits for what a restart needs (the probe), then runs until the plugin stops. */
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
      /** For tests: the debounced rewrite, now. */
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
