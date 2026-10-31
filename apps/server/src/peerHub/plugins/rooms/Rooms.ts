// @effect-diagnostics nodeBuiltinImport:off - a folder named over the wire must be a full path.
/**
 * Rooms: a task's room on this environment. What the person does goes to the Hub; what waits on them
 * and what this computer must act on is read from `/rooms/inbox` on a ping, at sync and on
 * reconnect, never on a timer. A delivery assigned here is carried by `follow.ts`; the messages for
 * a run wait in the run's queue until its notice or its next session's start carries them.
 *
 * @module peerHub/plugins/rooms/Rooms
 */
import * as NodePath from "node:path";

import {
  PeerHubError,
  type PeerRoomCapacity,
  type PeerRoomDiff,
  type PeerRoomInbox,
  type PeerRoomInboxItem,
  type PeerRoomRead,
  type PeerRoomsDeclineInput,
  type PeerRoomsPassInput,
  type PeerRoomsDiffInput,
  type PeerRoomsStepsInput,
  type PeerRoomSnapshot,
  type PeerRoomsSnapshotInput,
  type PeerRoomsThreadInput,
  type PeerRoomThread,
  type PeerRoomsPlace,
  type PeerRoomsPostInput,
  type PeerRoomsReadInput,
  type PeerRoomsFoldersInput,
  type PeerRoomsSeenInput,
  type PeerRoomsSetReachInput,
  type PeerRoomsWithdrawInput,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";

import * as AgentTranscript from "../../agentTranscript.ts";
import * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import type { PeerSessionView } from "../../core/plugin.ts";
import * as PeerPlugins from "../../core/plugins/PeerPlugins.ts";
import {
  handoffRunPrefix,
  messageKey,
  pinWork,
  sealWork,
  shareWork,
} from "../../core/workSnapshots.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import { runKeys } from "../../core/state/PeerState.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import { checkoutKind } from "../../core/vcs.ts";
import * as PeerWork from "../../core/work/PeerWork.ts";
import { changeToReview, pushedRefs, roomDiff, workRun, worktreeOf } from "./client/diff.ts";
import { changeDiff, stepDiff, workspaceChange, workspaceSteps } from "./client/steps.ts";
import { fetchPins, newestHandoff, pinnedRoot, readPin, storeOf } from "./client/snapshots.ts";
import { runQueues, tellable } from "./client/queue.ts";
import { statusOf } from "./client/status.ts";
import { projectsText, runRootsData } from "../../core/work/runRoots.ts";
import { capacityOf, checkoutOf, openRuns, roomStarts } from "./client/start.ts";
import { actOn, type FollowDeps, type HereRun } from "./follow.ts";
import { roomsHub, type Place, type PostBody } from "./client/hub.ts";
import { refOf, type Heard, type HeardKind } from "./text.ts";

interface HeardJob {
  readonly kind: "heard";
  readonly place: Place;
  readonly seq: number;
  readonly run: string | undefined;
}

type Job = { readonly kind: "read"; readonly workspace: string } | HeardJob;

const workspaceOf = (job: Job) => (job.kind === "read" ? job.workspace : job.place.workspace);

/** What stays queued when a person leaves `workspace`: every other workspace's work. */
export const jobsAfterLeaving = (jobs: ReadonlyArray<Job>, workspace: string) =>
  jobs.filter((job) => workspaceOf(job) !== workspace);

/** A Hub's refusal is final; anything else may not have reached it, so the move is owed still. */
const kindOf = (item: PeerRoomInboxItem, me: string): HeardKind =>
  item.message.author.email.toLowerCase() === me.toLowerCase() ? "own" : "passed";

const owed = (error: PeerHubError) =>
  error.status === undefined || error.status >= 500 || error.status === 429;

const THREAD_ONLY_CLAUDE = "Peer can read only Claude Code's thread here.";
const THREAD_SESSIONS = 3;
const THREAD_BYTES = 2 * 1024 * 1024;
const THREAD_ENTRIES = 200;

const make = Effect.gen(function* () {
  const state = yield* PeerState.PeerState;
  const status = yield* PeerStatus.PeerStatus;
  const agents = yield* PeerAgents.PeerAgents;
  const plugins = yield* PeerPlugins.PeerPlugins;
  const work = yield* PeerWork.PeerWork;
  const hub = roomsHub(yield* PeerHubClient.PeerHubClient);
  const inboxes = yield* Ref.make<ReadonlyMap<string, PeerRoomInbox>>(new Map());
  const jobs = yield* Queue.unbounded<Job>();
  /** Run → its messages not yet confirmed heard, in arrival order. */
  const queues = runQueues();
  const starts = roomStarts(state, work, plugins);
  const startedAt = yield* Clock.currentTimeMillis;
  /** `heard` moves the Hub never confirmed, sent again with the next read that reaches it. */
  const unsent = new Map<string, HeardJob>();
  const heardKey = ({ place, seq }: HeardJob) =>
    `${place.workspace}/${place.project}/${place.task}:${seq}`;
  /** Workspaces with a read already set for when a grace ends. */
  const rereads = new Set<string>();

  const emailOf = Effect.flatMap(state.email, (email) =>
    email === null
      ? Effect.fail(new PeerHubError({ detail: "Sign in first." }))
      : Effect.succeed(email),
  );
  const readSoon = (workspace: string) =>
    Queue.offer(jobs, { kind: "read", workspace }).pipe(Effect.asVoid);

  const placeOf = (workspace: string, item: PeerRoomInboxItem): Place => ({
    workspace,
    project: item.project,
    task: item.task,
  });

  const runsHere = (workspace: string, item: PeerRoomInboxItem) =>
    Effect.gen(function* () {
      const live = new Set(
        (yield* agents.sessions).flatMap((session) =>
          session.workspace === workspace &&
          session.project === item.project &&
          session.task === item.task &&
          session.run !== undefined
            ? [session.run]
            : [],
        ),
      );
      const open = yield* openRuns(state, placeOf(workspace, item));
      const launcher = yield* plugins
        .require("taskLauncher")
        .pipe(Effect.orElseSucceed(() => undefined));
      // Before the first work report nothing says which thread carries a run.
      const read = (yield* work.latestPass) !== null;
      return yield* Effect.forEach(
        [...new Set([...open.map((run) => run.id), ...live])],
        (id): Effect.Effect<HereRun> =>
          Effect.map(
            read ? capacityOf(state, work, workspace, item.project, id) : Effect.succeed(undefined),
            (capacity) => {
              const run = open.find((candidate) => candidate.id === id);
              return {
                id,
                live: live.has(id),
                capacity,
                running: run?.sessions.some((session) => session.to === undefined) === true,
                staysPut: run?.runtime === "terminal" || run?.runtime === "mcp",
                waiting: run !== undefined && launcher?.waiting?.(runKeys(run)) === true,
              };
            },
          ),
      );
    });

  /** Where the task's work may be: the project's checkout here, handoffs and every member's threads. */
  const workOf = (place: PeerRoomsPlace) =>
    Effect.gen(function* () {
      const { project } = yield* state.project(place.workspace, place.project);
      const checkout = yield* checkoutOf(state, place.workspace, project);
      const threads = (yield* work.threads(place.workspace, place.project))
        .filter((thread) => thread.task === place.task)
        .toSorted((a, b) => b.seenAt.localeCompare(a.seenAt));
      return {
        project,
        checkout,
        base: checkout?.repository.branch ?? project.repositories[0]?.branch ?? "main",
        handoffs: yield* hub.handoffs(place).pipe(Effect.orElseSucceed(() => [])),
        threads,
      };
    });

  /**
   * The run's thread from its Claude Code transcripts, oldest session first. They live on the
   * computer that ran it and nowhere else, and other harnesses keep theirs in their own shape.
   */
  const runThread = (sessions: ReadonlyArray<string>, until: string | undefined) =>
    Effect.promise(async (): Promise<PeerRoomThread> => {
      const claude = sessions.flatMap((id) => (id.startsWith("claude:") ? [id.slice(7)] : []));
      if (claude.length === 0) return { entries: [], note: THREAD_ONLY_CLAUDE };
      const lines: Array<string> = [];
      for (const id of claude.slice(-THREAD_SESSIONS)) {
        const path = await AgentTranscript.findClaudeTranscript({ id, path: undefined });
        if (path === null) continue;
        lines.push(
          ...(await AgentTranscript.readTranscriptTail(path, THREAD_BYTES).catch(() => [])),
        );
      }
      const entries = AgentTranscript.transcriptEntries(
        until === undefined ? lines : AgentTranscript.transcriptUntil(lines, until),
        { limit: THREAD_ENTRIES },
      );
      return entries.length > 0 ? { entries } : { entries, note: "Its transcript is empty here." };
    });

  const onJj = async (root: string) => (await checkoutKind(root).catch(() => null))?.kind === "jj";

  /** A workspace's steps; Git has none to show, and a failed read shows none rather than fails. */
  const runSteps = async (root: string) =>
    (await onJj(root))
      ? {
          steps: await workspaceSteps(root).catch(() => []),
          ...(await workspaceChange(root).then(
            (change) => ({ change }),
            () => ({}),
          )),
        }
      : { steps: [] };

  /** The project's runs that only read the work, as the review starter knows them. */
  const reviewsOf = (place: PeerRoomsPlace) =>
    plugins.require("reviewStarter").pipe(
      Effect.flatMap((starter) => starter.reviewRuns(place.workspace, place.project)),
      Effect.orElseSucceed((): ReadonlySet<string> => new Set()),
    );

  /** The checkout of this computer's newest run that does the task's work, detached ones too. */
  const runsHereToo = (place: PeerRoomsPlace) =>
    Effect.gen(function* () {
      const { persisted } = yield* state.read;
      const stored = Option.getOrUndefined(yield* runRootsData(state).read)?.runs ?? {};
      for (const [id, roots] of Object.entries(stored)) {
        if (persisted.runs?.[id]?.endedAt !== undefined) continue;
        const here = roots.find(
          (entry) => entry.project === place.project && entry.task === place.task,
        );
        if (here !== undefined) return { root: here.root, repository: here.repository };
      }
      return undefined;
    });

  const workHere = (place: PeerRoomsPlace, checkout: string | undefined, only?: string) =>
    Effect.gen(function* () {
      // A run asked for by name is shown whatever it does, a review's checkout too.
      const reviews = only === undefined ? yield* reviewsOf(place) : new Set<string>();
      const sessions = (yield* agents.sessions).filter(
        (session) =>
          session.workspace === place.workspace &&
          session.project === place.project &&
          session.task === place.task,
      );
      const found = workRun({
        runs: (yield* openRuns(state, place))
          .filter((run) => only === undefined || run.id === only)
          .map((run) => ({ id: run.id, keys: runKeys(run) })),
        reviews,
        sessions,
        threads: (yield* work.localThreads).get(place.workspace) ?? [],
      });
      if (found?.root !== undefined) return found;
      // A run of the shared room's other project works here too, in the checkout made for it.
      const carried = yield* runsHereToo(place);
      if (carried !== undefined) return { ...found, ...carried };
      const root =
        checkout === undefined
          ? undefined
          : yield* Effect.promise(async () => {
              const tree =
                found === undefined ? undefined : await worktreeOf(checkout, found.branch);
              if (tree !== undefined || only === undefined) return tree;
              // A session that ended leaves no trace of its workspace but what its messages kept.
              const store = await storeOf(checkout);
              return store === undefined ? undefined : pinnedRoot(store, place, only);
            });
      return root === undefined ? undefined : { root, repository: undefined };
    });

  const heardOf = (
    workspace: string,
    item: PeerRoomInboxItem,
    kind: HeardKind,
    me: string,
  ): Effect.Effect<Heard> =>
    Effect.map(work.taskName(workspace, item.project, item.task), (taskName) => ({
      ref: refOf(item.task, item.message.seq),
      workspace,
      project: item.project,
      kind,
      seq: item.message.seq,
      task: item.task,
      taskName,
      author: state.nameOf(workspace, item.message.author.email),
      owner: state.nameOf(workspace, me),
      text: item.message.text,
      anchor: item.message.anchor,
    }));

  const followDeps = (workspace: string, me: string): FollowDeps => ({
    me,
    runsHere: (item) => runsHere(workspace, item),
    isChat: (item) =>
      work.tasks(workspace, item.project).pipe(
        Effect.map((tasks) => tasks.some((task) => task.id === item.task && task.chat === true)),
        Effect.orElseSucceed(() => false),
      ),
    take: (item, run) =>
      hub
        .move(placeOf(workspace, item), item.message.seq, me, {
          move: "take",
          environment: state.environmentId,
          run,
          expect: "passed",
        })
        .pipe(Effect.asVoid),
    fail: (item, reason) =>
      hub
        .move(placeOf(workspace, item), item.message.seq, me, {
          move: "fail",
          environment: state.environmentId,
          reason: reason.slice(0, 300),
        })
        .pipe(Effect.ignore),
    record: (item, run) =>
      hub
        .move(placeOf(workspace, item), item.message.seq, me, {
          move: "take",
          environment: state.environmentId,
          run,
          expect: "taken",
        })
        .pipe(Effect.ignore),
    queuedRun: (item) => queues.runOf(workspace, item.project, refOf(item.task, item.message.seq)),
    prompted: (item, run, kind) =>
      Effect.gen(function* () {
        const promptedAt = yield* Clock.currentTimeMillis;
        queues.add(run, { ...(yield* heardOf(workspace, item, kind, me)), promptedAt });
      }),
    told: (item, run) => queues.wasTold(run, refOf(item.task, item.message.seq)),
    startedAt,
    later: (ms) => {
      if (rereads.has(workspace)) return Effect.void;
      rereads.add(workspace);
      return Effect.sleep(ms).pipe(
        Effect.andThen(readSoon(workspace)),
        Effect.ensuring(Effect.sync(() => rereads.delete(workspace))),
        Effect.forkChild,
        Effect.asVoid,
      );
    },
    queue: (item, run, kind) =>
      Effect.gen(function* () {
        queues.add(run, yield* heardOf(workspace, item, kind, me));
      }),
    unqueue: (item, run) =>
      Effect.sync(() => queues.remove(run, refOf(item.task, item.message.seq))),
    wake: agents.wake,
    continueRun: (item, run) =>
      Effect.map(
        agents.continueRun({ workspace, projectId: item.project, runId: run }),
        (result) => (result.started ? null : (result.reason ?? "Peer could not continue the run.")),
      ),
    review: (item) =>
      Effect.gen(function* () {
        const heard = yield* heardOf(workspace, item, "own", me);
        const place = placeOf(workspace, item);
        const { base, checkout, handoffs, threads } = yield* workOf(place);
        const refs = pushedRefs(handoffs, threads, base);
        const change =
          checkout === undefined
            ? undefined
            : yield* Effect.promise(() => changeToReview(checkout.path, refs));
        return yield* starts.review(workspace, item, me, heard, change);
      }),
    start: (item) =>
      Effect.flatMap(heardOf(workspace, item, kindOf(item, me), me), (heard) =>
        starts.work(workspace, item, me, heard),
      ),
  });

  const handle = (job: HeardJob) =>
    Effect.flatMap(emailOf, (email) =>
      hub.move(job.place, job.seq, email, {
        move: "heard",
        environment: state.environmentId,
        run: job.run,
      }),
    ).pipe(
      Effect.match({
        onFailure: (error) => (owed(error) ? void unsent.set(heardKey(job), job) : undefined),
        onSuccess: () => void unsent.delete(heardKey(job)),
      }),
    );

  /** Reads one workspace's inbox; one the Hub does not answer for keeps what was read before. */
  const read = (workspace: string) =>
    Effect.gen(function* () {
      const email = yield* state.email;
      if (email === null) return;
      const inbox = yield* hub.inbox(workspace, state.environmentId);
      yield* Ref.update(inboxes, (current) => new Map(current).set(workspace, inbox));
      queues.prune(workspace, inbox);
      yield* status.publish;
      for (const job of unsent.values()) if (workspaceOf(job) === workspace) yield* handle(job);
      const deps = followDeps(workspace, email);
      yield* Effect.forEach(inbox.work, (item) => actOn(deps, item), { discard: true });
    }).pipe(Effect.ignore);

  const readAll = Effect.gen(function* () {
    for (const workspace of yield* state.workspaces) yield* read(workspace.slug);
  });

  const after =
    (workspace: string) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      Effect.tap(effect, () => readSoon(workspace));

  const post = (place: Place, body: PostBody) => hub.post(place, body).pipe(after(place.workspace));

  const roomRead = (input: PeerRoomsReadInput) =>
    Effect.gen(function* () {
      const { after: since, limit, ...place } = input;
      const answer = yield* hub.read(place, {
        ...(since === undefined ? {} : { after: since }),
        ...(limit === undefined ? {} : { limit }),
      });
      const { project } = yield* state.project(place.workspace, place.project);
      const capacities: Record<string, PeerRoomCapacity> = {};
      for (const run of yield* openRuns(state, place))
        capacities[run.id] = yield* capacityOf(state, work, place.workspace, place.project, run.id);
      return {
        ...answer,
        hasCheckout: (yield* checkoutOf(state, place.workspace, project)) !== undefined,
        capacities,
        reviewRuns: [...(yield* reviewsOf(place))],
      } satisfies PeerRoomRead;
    });

  const move = (
    input: PeerRoomsPlace & { readonly seq: number },
    body: Parameters<typeof hub.move>[3],
  ) =>
    Effect.gen(function* () {
      const { seq, ...place } = input;
      const { workspace, project, task } = place;
      return yield* hub.move({ workspace, project, task }, seq, yield* emailOf, body);
    }).pipe(after(input.workspace));

  return {
    /** The plugin's status slice, read from memory. */
    status: Effect.map(Ref.get(inboxes), statusOf),
    read: roomRead,
    post: (input: PeerRoomsPostInput) => {
      const { workspace, project, task, ...body } = input;
      return post({ workspace, project, task }, { ...body, environment: state.environmentId });
    },
    /** An agent's post, from its run; `peer room say` and its tool go through here. */
    postAs: (session: PeerSessionView, run: string, body: Omit<PostBody, "environment" | "run">) =>
      Effect.gen(function* () {
        const place = {
          workspace: session.workspace,
          project: session.project,
          task: session.task ?? "",
        };
        // Sealed before the post, so the message is never ahead of the state it shows.
        const at = DateTime.formatIso(DateTime.makeUnsafe(yield* Clock.currentTimeMillis));
        const startedAt = (yield* state.read).persisted.runs?.[run]?.startedAt;
        const sealed = yield* Effect.promise(() =>
          sealWork(session.root || session.cwd, at, { id: run, startedAt }).catch(() => null),
        );
        const message = yield* post(place, { ...body, run, environment: state.environmentId });
        if (sealed !== null) {
          yield* Effect.promise(() => pinWork(sealed, place, messageKey(message.seq)));
          yield* shareWork(plugins, sealed.gitDir, place);
        }
        const others = Option.getOrUndefined(yield* runRootsData(state).read)?.runs[run] ?? [];
        for (const other of others.filter((entry) => entry.task !== "")) {
          const elsewhere = {
            workspace: place.workspace,
            project: other.project,
            task: other.task,
          };
          const kept = yield* Effect.promise(() =>
            sealWork(other.root, at, { id: run, startedAt }).catch(() => null),
          );
          if (kept === null) continue;
          yield* Effect.promise(() => pinWork(kept, elsewhere, messageKey(message.seq)));
          yield* shareWork(plugins, kept.gitDir, elsewhere);
        }
        return message;
      }),
    // What was read leaves Needs you: the Hub's list changes, and no ping says so.
    /** Where a run across projects works besides its own, in words; undefined for any other. */
    projectsOf: (run: string | undefined) =>
      Effect.map(runRootsData(state).read, (stored) => {
        const roots = run === undefined ? [] : (Option.getOrUndefined(stored)?.runs[run] ?? []);
        return roots.length === 0 ? undefined : projectsText(roots);
      }),
    folders: ({ group, folders }: PeerRoomsFoldersInput) =>
      Effect.gen(function* () {
        const absolute = folders.filter(({ folder }) => NodePath.isAbsolute(folder));
        yield* runRootsData(state)
          .update((current) => {
            const stored = Option.getOrUndefined(current);
            return {
              runs: stored?.runs ?? {},
              folders: { ...stored?.folders, [group]: absolute },
            };
          })
          .pipe(state.lock.withPermits(1));
        return { saved: absolute.length };
      }),
    seen: ({ seq, ...place }: PeerRoomsSeenInput) =>
      hub.seen(place, seq).pipe(after(place.workspace)),
    pass: (input: PeerRoomsPassInput) =>
      move(input, { move: "pass", environment: state.environmentId, expect: input.expect }),
    decline: (input: PeerRoomsDeclineInput) =>
      move(input, { move: "decline", reason: input.reason, expect: input.expect }),
    withdraw: ({ seq, ...place }: PeerRoomsWithdrawInput) =>
      hub.withdraw(place, seq).pipe(after(place.workspace)),
    setReach: (input: PeerRoomsSetReachInput) =>
      Effect.gen(function* () {
        const capacity = yield* capacityOf(state, work, input.workspace, input.project, input.run);
        return yield* hub.reach(input.workspace, input.project, input.run, {
          reach: input.reach,
          capacity,
        });
      }),
    thread: ({ run, until, ...place }: PeerRoomsThreadInput) =>
      Effect.gen(function* () {
        const { persisted } = yield* state.read;
        const found = persisted.runs?.[run];
        if (
          found === undefined ||
          found.workspace !== place.workspace ||
          found.project !== place.project ||
          found.task !== place.task
        ) {
          return {
            entries: [],
            note: "This agent ran on another computer, so its thread is there.",
          };
        }
        return yield* runThread(
          found.sessions.map((session) => session.id),
          until,
        );
      }),
    /** The run's steps, where its workspace is on this computer and on jj; else none. */
    steps: ({ run, ...place }: PeerRoomsStepsInput) =>
      Effect.gen(function* () {
        const { checkout } = yield* workOf(place);
        const root = (yield* workHere(place, checkout?.path, run))?.root;
        if (root === undefined) return { steps: [] };
        return yield* Effect.promise(() => runSteps(root));
      }),
    diff: ({
      run,
      step,
      ...place
    }: PeerRoomsDiffInput): Effect.Effect<PeerRoomDiff, PeerHubError> =>
      Effect.gen(function* () {
        const { project, base, checkout, handoffs, threads } = yield* workOf(place);
        const views = yield* agents.view(place.workspace);
        const here = yield* workHere(place, checkout?.path, run);
        if (step !== undefined && here?.root !== undefined) {
          const root = here.root;
          const shown = yield* Effect.promise(() => stepDiff(root, step).catch(() => null));
          if (shown !== null) {
            return { ...shown, folder: root };
          }
        }
        // A run asked for by name is the change it carries, which only jj can say on jj.
        if (run !== undefined && here?.root !== undefined) {
          const root = here.root;
          const carried = yield* Effect.promise(async () =>
            (await onJj(root)) ? changeDiff(root).catch(() => null) : null,
          );
          if (carried !== null) return { ...carried, folder: root };
        }
        const diff = yield* roomDiff({
          root: here?.root,
          rootBase: project.repositories.find((row) => row.id === here?.repository)?.branch,
          base,
          checkout,
          handoffs,
          threads,
          files: views.sessions.flatMap((session) =>
            session.task === place.task ? session.files : [],
          ),
          nameOf: (email) => state.nameOf(place.workspace, email),
        });
        const folder = here?.root ?? checkout?.path;
        return folder === undefined ? diff : { ...diff, folder };
      }),
    /** The moment `key` pinned, wherever this computer can reach it; never today's state. */
    snapshot: ({ key, run, ...place }: PeerRoomsSnapshotInput) =>
      Effect.gen(function* () {
        const room = { workspace: place.workspace, project: place.project, task: place.task };
        const { checkout } = yield* workOf(place);
        const here = run === undefined ? undefined : yield* workHere(place, checkout?.path, run);
        const folders = [here?.root, checkout?.path].flatMap((folder) => folder ?? []);
        const now = yield* Clock.currentTimeMillis;
        return yield* Effect.promise(async (): Promise<PeerRoomSnapshot> => {
          const stores = [
            ...new Set((await Promise.all(folders.map(storeOf))).flatMap((store) => store ?? [])),
          ];
          const look = async () => {
            for (const store of stores) {
              const pin = await readPin(store, room, key).catch(() => null);
              if (pin !== null) return { pin, store };
            }
            return undefined;
          };
          const found =
            (await look()) ??
            ((await Promise.all(stores.map((store) => fetchPins(store, room, now)))).some(Boolean)
              ? await look()
              : undefined);
          const handoffs = await Promise.all(
            run === undefined
              ? []
              : stores.map((store) => newestHandoff(store, room, handoffRunPrefix(run))),
          );
          const handoff = handoffs.find((one) => one !== undefined);
          const named = handoff === undefined ? {} : { handoff };
          if (found !== undefined) return { ...found.pin, ...named };
          return {
            state: "none",
            reason:
              stores.length === 0
                ? "This computer has no checkout of the project, so it cannot read a kept state."
                : "Peer kept no state of the work for this moment here. It is kept when an agent posts on Jujutsu, and reaches other computers when its author shares work in progress.",
            ...named,
          };
        });
      }),
    waiting: queues.of,
    /** What a step may tell now, as the Hub says of each message. */
    tellable: (run: string | undefined, candidates: ReadonlyArray<Heard>) =>
      Effect.flatMap(state.email, (me) =>
        me === null
          ? Effect.succeed<ReadonlyArray<Heard>>([])
          : tellable({
              queues,
              run,
              candidates,
              me,
              read: ({ workspace, project, task, seq }) =>
                hub
                  .read({ workspace, project, task }, { after: seq - 1, limit: 1 })
                  .pipe(
                    Effect.map(({ messages }) => messages.find((message) => message.seq === seq)),
                  ),
            }),
      ),
    /** A heard or answered message leaves its run's queue. */
    settled: queues.settle,
    /** `hooks.delivery` must not do I/O: the plugin's `run` sends the move. */
    queueHeard: (session: PeerSessionView, ref: string) => {
      const [task, seq] = [
        ref.slice(0, ref.lastIndexOf(":")),
        Number(ref.slice(ref.lastIndexOf(":") + 1)),
      ];
      return Queue.offer(jobs, {
        kind: "heard",
        place: { workspace: session.workspace, project: session.project, task },
        seq,
        run: session.run,
      }).pipe(Effect.asVoid);
    },
    wake: agents.wake,
    readSoon,
    /** Reads every workspace now, then as pings and syncs ask, and sends what hooks queued. */
    follow: Effect.gen(function* () {
      yield* readAll;
      while (true) {
        const first = yield* Queue.take(jobs);
        const batch = [first, ...(yield* Queue.clear(jobs))];
        for (const job of batch) if (job.kind === "heard") yield* handle(job);
        for (const job of new Set(
          batch.flatMap((job) => (job.kind === "read" ? [job.workspace] : [])),
        ))
          yield* read(job);
      }
    }),
    /** Forgets one workspace's rooms, or every one's: signing out, leaving, turning off. */
    forget: (workspace?: string) =>
      Effect.gen(function* () {
        const left = yield* Queue.clear(jobs);
        if (workspace !== undefined) yield* Queue.offerAll(jobs, jobsAfterLeaving(left, workspace));
        for (const [key, job] of unsent)
          if (workspace === undefined || workspaceOf(job) === workspace) unsent.delete(key);
        queues.forget(workspace);
        yield* Ref.update(inboxes, (current) => {
          const next = new Map(workspace === undefined ? [] : current);
          if (workspace !== undefined) next.delete(workspace);
          return next;
        });
      }),
    keep: (workspaces: ReadonlyArray<string>) =>
      Effect.andThen(
        Effect.sync(() => {
          queues.keep(workspaces);
          for (const [key, job] of unsent)
            if (!workspaces.includes(workspaceOf(job))) unsent.delete(key);
        }),
        Ref.update(
          inboxes,
          (current) => new Map([...current].filter(([slug]) => workspaces.includes(slug))),
        ),
      ),
  };
});

export class Rooms extends Context.Service<Rooms, Effect.Success<typeof make>>()(
  "t3/peerHub/plugins/rooms/Rooms",
) {}

export const layer = Layer.effect(Rooms, make);
