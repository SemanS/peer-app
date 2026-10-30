/**
 * Rooms: a task's room on this environment. What the person does goes to the Hub; what waits on them
 * and what this computer must act on is read from `/rooms/inbox` on a ping, at sync and on
 * reconnect, never on a timer. A delivery assigned here is carried by `follow.ts`; the messages for
 * a run wait in the run's queue until its notice or its next session's start carries them.
 *
 * @module peerHub/plugins/rooms/Rooms
 */
import {
  PeerHubError,
  type PeerRoomCapacity,
  type PeerRoomDiff,
  type PeerRoomInbox,
  type PeerRoomInboxItem,
  type PeerRoomRead,
  type PeerRoomsDeclineInput,
  type PeerRoomsPassInput,
  type PeerRoomsPlace,
  type PeerRoomsPostInput,
  type PeerRoomsReadInput,
  type PeerRoomsSeenInput,
  type PeerRoomsSetReachInput,
  type PeerRoomsWithdrawInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";

import * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import type { PeerSessionView } from "../../core/plugin.ts";
import * as PeerPlugins from "../../core/plugins/PeerPlugins.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import * as PeerWork from "../../core/work/PeerWork.ts";
import { roomDiff } from "./client/diff.ts";
import { runQueues, tellable } from "./client/queue.ts";
import { statusOf } from "./client/status.ts";
import { capacityOf, checkoutOf, openRuns, roomStarts } from "./client/start.ts";
import { act, type FollowDeps, type HereRun } from "./follow.ts";
import { roomsHub, type Place, type PostBody } from "./client/hub.ts";
import { refOf, type Heard, type HeardKind } from "./text.ts";

type Job =
  | { readonly kind: "read"; readonly workspace: string }
  | {
      readonly kind: "heard";
      readonly place: Place;
      readonly seq: number;
      readonly run: string | undefined;
    };

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
      const open = (yield* openRuns(state, placeOf(workspace, item))).map((run) => run.id);
      // Before the first work report nothing says which thread carries a run.
      const read = (yield* work.latestPass) !== null;
      return yield* Effect.forEach([...new Set([...open, ...live])], (id): Effect.Effect<HereRun> =>
        Effect.map(
          read ? capacityOf(state, work, workspace, item.project, id) : Effect.succeed(undefined),
          (capacity) => ({ id, live: live.has(id), capacity }),
        ),
      );
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
    heard: (item, run) =>
      hub
        .move(placeOf(workspace, item), item.message.seq, me, {
          move: "heard",
          environment: state.environmentId,
          run,
        })
        .pipe(Effect.ignore),
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
      Effect.flatMap(heardOf(workspace, item, "own", me), (heard) =>
        starts.review(workspace, item, me, heard),
      ),
    start: (item) =>
      Effect.flatMap(heardOf(workspace, item, "passed", me), (heard) =>
        starts.work(workspace, item, me, heard),
      ),
  });

  /** Reads one workspace's inbox; one the Hub does not answer for keeps what was read before. */
  const read = (workspace: string) =>
    Effect.gen(function* () {
      const email = yield* state.email;
      if (email === null) return;
      const inbox = yield* hub.inbox(workspace, state.environmentId);
      yield* Ref.update(inboxes, (current) => new Map(current).set(workspace, inbox));
      queues.prune(workspace, inbox);
      yield* status.publish;
      const deps = followDeps(workspace, email);
      yield* Effect.forEach(inbox.work, (item) => act(deps, item), { discard: true });
    }).pipe(Effect.ignore);

  const readAll = Effect.gen(function* () {
    for (const workspace of yield* state.workspaces) yield* read(workspace.slug);
  });

  const handle = (job: Extract<Job, { kind: "heard" }>) =>
    Effect.flatMap(emailOf, (email) =>
      hub.move(job.place, job.seq, email, {
        move: "heard",
        environment: state.environmentId,
        run: job.run,
      }),
    ).pipe(Effect.ignore);

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
      post(
        { workspace: session.workspace, project: session.project, task: session.task ?? "" },
        { ...body, run, environment: state.environmentId },
      ),
    seen: ({ seq, ...place }: PeerRoomsSeenInput) => hub.seen(place, seq),
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
    diff: (place: PeerRoomsPlace): Effect.Effect<PeerRoomDiff, PeerHubError> =>
      Effect.gen(function* () {
        const { project } = yield* state.project(place.workspace, place.project);
        const sessions = yield* agents.sessions;
        const root = sessions.find(
          (session) =>
            session.workspace === place.workspace &&
            session.project === place.project &&
            session.task === place.task,
        )?.root;
        const views = yield* agents.view(place.workspace);
        const threads = (yield* work.threads(place.workspace, place.project))
          .filter((thread) => thread.task === place.task)
          .toSorted((a, b) => b.seenAt.localeCompare(a.seenAt));
        return yield* roomDiff({
          root,
          base: project.repositories[0]?.branch ?? "main",
          checkout: yield* checkoutOf(state, place.workspace, project),
          handoffs: yield* hub.handoffs(place).pipe(Effect.orElseSucceed(() => [])),
          threads,
          files: views.sessions.flatMap((session) =>
            session.task === place.task ? session.files : [],
          ),
          nameOf: (email) => state.nameOf(place.workspace, email),
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
    settled: queues.remove,
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
        yield* Queue.clear(jobs);
        queues.forget(workspace);
        yield* Ref.update(inboxes, (current) => {
          const next = new Map(workspace === undefined ? [] : current);
          if (workspace !== undefined) next.delete(workspace);
          return next;
        });
      }),
    keep: (workspaces: ReadonlyArray<string>) =>
      Effect.andThen(
        Effect.sync(() => queues.keep(workspaces)),
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
