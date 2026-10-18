// @effect-diagnostics nodeBuiltinImport:off - task checkouts as the file system knows them.
/**
 * The task checkouts herdr's launcher made, and their removal once their task is done. Peer
 * remembers each one it made (`taskWorktreeCreated`) and, about once a minute while it follows
 * herdr, looks at those whose task is done. One an agent still runs in stays; the agent's row says
 * whether Peer removes it once the agent is closed or keeps it and why. One no agent runs in is
 * removed when `removeTaskCheckout` finds nothing in it can be lost, and kept, saying why in the
 * log, otherwise. Checkouts Peer did not make, or made before it remembered them, are never touched.
 *
 * @module peerHub/plugins/herdr/client/checkouts
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";

import type { PeerLifecycleEvent } from "../../../core/plugin.ts";
import * as PeerState from "../../../core/state/PeerState.ts";
import * as PeerWork from "../../../core/work/PeerWork.ts";
import { checkTaskCheckout } from "./cleanup.ts";
import type { HerdrAgentState, HerdrAgents } from "../follower.ts";

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

/** A directory as the file system knows it (macOS keeps /var under /private). */
export const realDirectory = (path: string) => {
  try {
    return NodeFS.realpathSync(path);
  } catch {
    return NodePath.resolve(path);
  }
};

const within = (path: string, folder: string) =>
  path === folder || path.startsWith(`${folder}${NodePath.sep}`);

/** herdr's list is read and says every agent's folder. */
const knowsEveryFolder = (
  running: ReadonlyArray<HerdrAgentState> | null,
): running is ReadonlyArray<HerdrAgentState> =>
  running !== null && running.every((agent) => agent.cwd !== undefined);

/** An agent works in the folder, or in a folder that holds it. */
const uses = (agent: HerdrAgentState, folder: string) => {
  const there = realDirectory(agent.cwd!);
  return within(there, folder) || within(folder, there);
};

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
      // Without herdr's list, or with an agent whose folder herdr does not say, Peer cannot tell
      // that no agent runs in a checkout: it touches nothing.
      if (!knowsEveryFolder(agents.current())) return;
      const { persisted } = yield* state.read;
      const checkouts = Option.getOrUndefined(yield* data.read)?.checkouts ?? {};
      const next = new Map<string, string>();
      const gone: Array<string> = [];
      for (const [cwd, record] of Object.entries(checkouts)) {
        const tasks = yield* work.tasks(record.workspace, record.project);
        if (tasks.find((task) => task.id === record.task)?.status !== "done") continue;
        const folder = realDirectory(cwd);
        const inUse = () => {
          const running = agents.current();
          return !knowsEveryFolder(running) || running.some((agent) => uses(agent, folder));
        };
        const checked = yield* Effect.promise(() =>
          checkTaskCheckout({
            checkout: state.checkoutPath(
              persisted,
              record.workspace,
              record.project,
              record.repository,
            ),
            worktrees: NodePath.join(
              state.workspaceRoot,
              ".worktrees",
              record.workspace,
              record.project,
              record.repository,
            ),
            cwd,
            identity: record.identity,
          }),
        );
        if (!checked.ok) {
          next.set(folder, `Peer keeps this checkout: ${checked.reason}.`);
          if (!inUse())
            yield* Effect.logInfo("Peer keeps a done task's checkout", {
              cwd,
              reason: checked.reason,
            });
          continue;
        }
        // herdr's list is read again here: the checks above take a while.
        if (inUse()) {
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

    /**
     * Forgets the checkouts of a workspace left, or all of them; their folders stay. Lifecycle
     * events arrive under the state lock.
     */
    const forget = (workspace?: string) =>
      Effect.gen(function* () {
        // A checkout queued before the leave must not be remembered after it.
        const queued = yield* Queue.clear(created);
        if (workspace !== undefined)
          yield* Queue.offerAll(
            created,
            queued.filter((event) => event.workspace !== workspace),
          );
        yield* rewrite((all) =>
          workspace === undefined
            ? {}
            : Object.fromEntries(
                Object.entries(all).filter(([, record]) => record.workspace !== workspace),
              ),
        );
      }).pipe(Effect.ignore);

    return {
      /** Queues a checkout the launcher made; nothing else happens on the launch path. */
      created: (event: Created) => Queue.offer(created, event).pipe(Effect.asVoid),
      /** What an agent running in `cwd` shows of its task checkout, if anything. */
      noteOf: (cwd: string | undefined): { readonly checkoutNote?: string } => {
        const note =
          cwd === undefined
            ? undefined
            : [...notes].find(([folder]) => within(realDirectory(cwd), folder))?.[1];
        return note === undefined ? {} : { checkoutNote: note };
      },
      run,
      look,
      /** The plugin's slots for them: made by its launcher, forgotten on leave or sign-out. */
      contributions: {
        taskWorktreeCreated: (event: Created) => Queue.offer(created, event).pipe(Effect.asVoid),
        workspaceCleanup: (
          event: Exclude<PeerLifecycleEvent, { readonly kind: "signed-in" | Created["kind"] }>,
        ) =>
          event.kind === "signing-out"
            ? forget()
            : event.kind === "left-workspace"
              ? forget(event.workspace)
              : Effect.void,
      },
    };
  });
