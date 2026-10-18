// @effect-diagnostics nodeBuiltinImport:off - task checkouts as the file system knows them.
/**
 * The task checkouts herdr's launcher made, and their removal once their task is done. Peer
 * remembers each one it made (`taskWorktreeCreated`) and, about once a minute while it follows
 * herdr, looks at those whose task is done. One an agent still runs in stays; the agent's row says
 * whether Peer removes it once the agent is closed or keeps it and why. One no agent runs in is
 * removed when `removeTaskCheckout` finds nothing in it can be lost, and kept, saying why in the
 * log, otherwise. Checkouts Peer did not make, or made before it remembered them, are never touched.
 *
 * @module peerHub/plugins/herdr/checkouts
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";

import type { PeerLifecycleEvent } from "../../core/plugin.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import * as PeerWork from "../../core/work/PeerWork.ts";
import { checkTaskCheckout } from "./client/cleanup.ts";
import type { HerdrAgents } from "./follower.ts";

const TaskCheckout = Schema.Struct({
  workspace: Schema.String,
  project: Schema.String,
  repository: Schema.String,
  task: Schema.String,
  identity: Schema.String,
});

/** The herdr plugin's slice of Peer's state: the owner's runtime choice and the task checkouts. */
export const HerdrData = Schema.Struct({
  bundled: Schema.Boolean,
  /** Folder → the task checkout Peer made there. */
  checkouts: Schema.optional(Schema.Record(Schema.String, TaskCheckout)),
});
export type HerdrData = typeof HerdrData.Type;

export const herdrData = (state: PeerState.PeerState["Service"]) =>
  state.pluginData("herdr", HerdrData);

type Created = Extract<PeerLifecycleEvent, { readonly kind: "task-worktree-created" }>;

const SWEEP_MS = 60_000;

const realDirectory = (path: string) => {
  try {
    return NodeFS.realpathSync(path);
  } catch {
    return NodePath.resolve(path);
  }
};

const within = (path: string, folder: string) =>
  path === folder || path.startsWith(`${folder}${NodePath.sep}`);

export const makeTaskCheckouts = (agents: HerdrAgents) =>
  Effect.gen(function* () {
    const state = yield* PeerState.PeerState;
    const work = yield* PeerWork.PeerWork;
    const data = herdrData(state);
    const created = yield* Queue.unbounded<Created>();
    /** Folder → what an agent's row says of it, from the last look. */
    let notes = new Map<string, string>();

    /** Rewrites the remembered checkouts; the caller holds the state lock. */
    const rewrite = (
      f: (checkouts: NonNullable<HerdrData["checkouts"]>) => HerdrData["checkouts"],
    ) =>
      data.update((current) => {
        const now: HerdrData = Option.getOrElse(current, () => ({ bundled: true }));
        return { ...now, checkouts: f(now.checkouts ?? {}) };
      });
    const update = (f: Parameters<typeof rewrite>[0]) => rewrite(f).pipe(state.lock.withPermits(1));

    const remember = (events: ReadonlyArray<Created>) =>
      update((checkouts) => {
        const next = { ...checkouts };
        for (const event of events)
          next[event.root] = {
            workspace: event.workspace,
            project: event.project,
            repository: event.repository,
            task: event.task,
            identity: event.identity,
          };
        return next;
      });

    /** Remembers the checkouts made since, then looks at those whose task is done. */
    const look = Effect.gen(function* () {
      const made = yield* Queue.clear(created);
      if (made.length > 0) yield* remember(made);
      const running = agents.current();
      // Without herdr's list Peer cannot tell that no agent runs in a checkout: touch nothing.
      if (running === null) return;
      const { persisted } = yield* state.read;
      const checkouts = Option.getOrUndefined(yield* data.read)?.checkouts ?? {};
      const next = new Map<string, string>();
      const gone: Array<string> = [];
      for (const [cwd, record] of Object.entries(checkouts)) {
        const tasks = yield* work.tasks(record.workspace, record.project);
        if (tasks.find((task) => task.id === record.task)?.status !== "done") continue;
        const folder = realDirectory(cwd);
        const inUse = running.some(
          (agent) => agent.cwd !== undefined && within(realDirectory(agent.cwd), folder),
        );
        const checked = yield* Effect.promise(() =>
          checkTaskCheckout({
            checkout: state.checkoutPath(
              persisted,
              record.workspace,
              record.project,
              record.repository,
            ),
            worktrees: NodePath.dirname(cwd),
            cwd,
            identity: record.identity,
          }),
        );
        if (!checked.ok) {
          next.set(folder, `Peer keeps this checkout: ${checked.reason}.`);
          if (!inUse)
            yield* Effect.logInfo("Peer keeps a done task's checkout", {
              cwd,
              reason: checked.reason,
            });
          continue;
        }
        if (inUse) {
          next.set(
            folder,
            "Its task is done: Peer removes this checkout once the agent is closed.",
          );
          continue;
        }
        const removed = yield* Effect.tryPromise(checked.remove).pipe(Effect.result);
        if (removed._tag === "Success") gone.push(cwd);
        else
          yield* Effect.logWarning("Peer could not remove a done task's checkout", {
            cwd,
            cause: String(removed.failure.cause),
          });
      }
      notes = next;
      if (gone.length > 0)
        yield* update((all) =>
          Object.fromEntries(Object.entries(all).filter(([cwd]) => !gone.includes(cwd))),
        );
    });

    /** Looks once a checkout is made, and about once a minute. */
    const run = Effect.gen(function* () {
      while (true) {
        yield* Queue.peek(created).pipe(Effect.timeoutOption(SWEEP_MS), Effect.ignore);
        yield* look.pipe(Effect.ignoreCause({ log: true }));
      }
    });

    return {
      /** Queues a checkout the launcher made; nothing else happens on the launch path. */
      created: (event: Created) => Queue.offer(created, event).pipe(Effect.asVoid),
      /** What an agent running in `cwd` shows of its task checkout, if anything. */
      noteOf: (cwd: string | undefined) =>
        cwd === undefined
          ? undefined
          : [...notes].find(([folder]) => within(realDirectory(cwd), folder))?.[1],
      /**
       * Forgets the checkouts of a workspace left, or all of them; their folders stay. Lifecycle
       * events arrive under the state lock.
       */
      forget: (workspace?: string) =>
        rewrite((all) =>
          workspace === undefined
            ? {}
            : Object.fromEntries(
                Object.entries(all).filter(([, record]) => record.workspace !== workspace),
              ),
        ).pipe(Effect.ignore),
      run,
      look,
    };
  });
