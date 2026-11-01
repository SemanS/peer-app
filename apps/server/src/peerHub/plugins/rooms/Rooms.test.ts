// @effect-diagnostics preferSchemaOverJson:off nodeBuiltinImport:off - the bodies the Hub was sent, and a checkout in a temporary directory.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { PEER_ROOM_START_GRACE_MS, type PeerRoomDiff } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as TestClock from "effect/testing/TestClock";

import {
  bindPlugin,
  type PeerContributions,
  type PeerLifecycleEvent,
  type PeerTaskLauncher,
} from "../../core/plugin.ts";
import { TEST_ENVIRONMENT, type HubCall } from "../../core/testkit.ts";
import { harnessOf } from "./client/start.ts";
import {
  BOB,
  EVA,
  contributionsOf,
  messageOf,
  NOW,
  roomHubOf,
  ROOM,
  roomPeer,
  roomsWhen,
  sessionOf,
  TASK,
} from "./fixtures.test.ts";
import { RoomsPlugin } from "./index.ts";
import { jobsAfterLeaving } from "./Rooms.ts";

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer));

const place = { workspace: "acme", project: "app", task: "vl-7" };

type Peer = Effect.Success<ReturnType<typeof roomPeer>>;

/** Calls the plugin's RPC handler for `method`, as the apps do. */
const rpc = (peer: Peer, method: string, input: unknown) =>
  Effect.gen(function* () {
    const { rpc: contributed } = yield* contributionsOf(peer);
    const handlers = contributed?.handlers({
      effect: (_, effect) => effect as never,
      stream: (_, stream) => stream as never,
    }) as Record<string, (input: unknown) => Effect.Effect<unknown, { readonly detail: string }>>;
    return yield* handlers[method]!(input);
  });

/** Waits on what the plugin's own fiber does; each turn hands it the runtime. */
const waitFor = (done: () => boolean) =>
  Effect.gen(function* () {
    while (!done()) yield* Effect.promise(() => new Promise((resolve) => setImmediate(resolve)));
  });

const bodyOf = (call: HubCall | undefined) => JSON.parse(call?.body ?? "{}") as unknown;
const callsTo = (peer: Peer, method: string, part: string) =>
  peer.server.calls.filter((call) => call.method === method && call.url?.includes(part));

describe("the rooms plugin", () => {
  it("is defined as its Settings row says", () => {
    assert.strictEqual(RoomsPlugin.id, "rooms");
    assert.isTrue(RoomsPlugin.defaultEnabled);
    assert.deepStrictEqual(RoomsPlugin.hubFeature, { id: "rooms", revision: 2 });
    assert.deepStrictEqual(RoomsPlugin.commandNames, ["room", "ready", "blocked", "ask", "note"]);
  });

  it.effect("is inactive where the Hub does not serve rooms, and refuses saying so", () =>
    run(
      Effect.gen(function* () {
        const peer = yield* roomPeer(roomHubOf({ features: {} }));
        assert.isFalse(yield* peer.plugins.isActive("rooms"));
        const refused = yield* peer.plugins.requireActive("rooms").pipe(Effect.result);
        assert.isTrue(Result.isFailure(refused));
        if (Result.isFailure(refused))
          assert.strictEqual(refused.failure.detail, "Task rooms needs a newer Peer Hub.");
        assert.isUndefined((yield* peer.status.publish).rooms);
      }),
    ),
  );

  it.effect("turned off, leaves the status and forgets what it read", () =>
    run(
      Effect.gen(function* () {
        const need = { project: "app", task: "vl-7", message: messageOf() };
        const current = roomHubOf();
        current.inbox = { ...current.inbox, waiting: [need] };
        const peer = yield* roomPeer(current);
        yield* roomsWhen(peer.status, (rooms) => rooms?.waiting.length === 1);
        yield* peer.plugins.setPlugin({ id: "rooms", enabled: false });
        assert.isUndefined((yield* peer.status.publish).rooms);
      }),
    ),
  );
});

describe("what a person does in a room", () => {
  it.effect("reads the room, with what only this computer can say", () =>
    run(
      Effect.gen(function* () {
        const peer = yield* roomPeer(roomHubOf());
        const read = (yield* rpc(peer, "peer.rooms.read", { ...place, after: 3, limit: 5 })) as {
          seq: number;
          hasCheckout: boolean;
        };
        assert.strictEqual(read.seq, 12);
        assert.isFalse(read.hasCheckout);
        assert.lengthOf(callsTo(peer, "GET", `${ROOM}?after=3&limit=5`), 1);
      }),
    ),
  );

  it.effect("posts with this computer as the environment, and names no run", () =>
    run(
      Effect.gen(function* () {
        const peer = yield* roomPeer(roomHubOf());
        const to = [{ kind: "agent", email: EVA }];
        yield* rpc(peer, "peer.rooms.post", { ...place, op: "o1", text: "Hi", to });
        assert.deepStrictEqual(bodyOf(callsTo(peer, "POST", ROOM)[0]), {
          op: "o1",
          text: "Hi",
          to,
          environment: TEST_ENVIRONMENT,
        });
      }),
    ),
  );

  it.effect("passes on, naming this computer, and declines with a reason", () =>
    run(
      Effect.gen(function* () {
        const peer = yield* roomPeer(roomHubOf());
        yield* rpc(peer, "peer.rooms.pass", { ...place, seq: 12, expect: "waiting" });
        yield* rpc(peer, "peer.rooms.decline", { ...place, seq: 13, reason: "Not now" });
        const url = (seq: number) => `${ROOM}/${seq}/deliveries/${encodeURIComponent(BOB)}`;
        assert.deepStrictEqual(bodyOf(callsTo(peer, "PATCH", url(12))[0]), {
          move: "pass",
          environment: TEST_ENVIRONMENT,
          expect: "waiting",
        });
        assert.deepStrictEqual(bodyOf(callsTo(peer, "PATCH", url(13))[0]), {
          move: "decline",
          reason: "Not now",
        });
      }),
    ),
  );

  it.effect("withdraws, and marks seen", () =>
    run(
      Effect.gen(function* () {
        const peer = yield* roomPeer(roomHubOf());
        yield* rpc(peer, "peer.rooms.withdraw", { ...place, seq: 12 });
        yield* rpc(peer, "peer.rooms.seen", { ...place, seq: 12 });
        assert.lengthOf(callsTo(peer, "DELETE", `${ROOM}/12`), 1);
        assert.deepStrictEqual(bodyOf(callsTo(peer, "POST", `${ROOM}/seen`)[0]), { seq: 12 });
      }),
    ),
  );
});

describe("which agent a start uses", () => {
  const itemBy = (author: string) => ({
    project: "app",
    task: "vl-7",
    message: messageOf({
      author: { email: author },
      to: [{ kind: "agent", email: BOB, state: "passed", harness: "claude" }],
    }),
  });

  it("is the one a person names for their own turn", () => {
    assert.strictEqual(harnessOf(itemBy(BOB), BOB), "claude");
  });

  it("is Claude Code, whatever a colleague's message names", () => {
    const item = { ...itemBy(EVA) };
    assert.strictEqual(
      harnessOf(
        {
          ...item,
          message: { ...item.message, to: [{ ...item.message.to[0]!, harness: "codex" }] },
        },
        BOB,
      ),
      "claude",
    );
  });
});

describe("the status", () => {
  it.effect("shows what waits, clipped, with each room's sequence", () =>
    run(
      Effect.gen(function* () {
        const current = roomHubOf();
        const many = Array.from({ length: 40 }, (_, at) => ({
          project: "app",
          task: "vl-7",
          message: messageOf({ seq: at + 1, text: "w ".repeat(400) }),
        }));
        current.inbox = {
          waiting: many,
          mentions: [
            {
              project: "app",
              task: "vl-7",
              message: messageOf({ seq: 41, author: { email: EVA, run: "run_e" }, to: [] }),
            },
          ],
          work: [],
          seqs: { app: { "vl-7": 41 } },
          revs: { app: { "vl-7": 57 } },
        };
        const peer = yield* roomPeer(current);
        const rooms = yield* roomsWhen(peer.status, (next) => next?.mentions.length === 1);
        assert.lengthOf(rooms?.waiting ?? [], 32);
        assert.isAtMost(rooms?.waiting[0]?.text.length ?? 0, 200);
        assert.isTrue(rooms?.waiting[0]?.cut);
        assert.deepStrictEqual(rooms?.mentions[0], {
          workspace: "acme",
          project: "app",
          task: "vl-7",
          seq: 41,
          author: EVA,
          agent: true,
          text: "Why this total?",
          at: NOW,
        });
        assert.deepStrictEqual(rooms?.seqs, { acme: { app: { "vl-7": 41 } } });
        assert.deepStrictEqual(rooms?.revs, { acme: { app: { "vl-7": 57 } } });
      }),
    ),
  );

  it.effect("reads the inbox again on a rooms ping", () =>
    run(
      Effect.gen(function* () {
        const current = roomHubOf();
        const peer = yield* roomPeer(current);
        yield* roomsWhen(peer.status, (rooms) => rooms !== undefined);
        current.inbox = { ...current.inbox, seqs: { app: { "vl-7": 2 } } };
        const { hubChanges } = yield* contributionsOf(peer);
        assert.deepStrictEqual(hubChanges?.changes, ["rooms"]);
        assert.isTrue(hubChanges?.ownEcho);
        yield* hubChanges!.onPing({
          workspace: "acme",
          change: "rooms",
          origin: null,
          data: { project: "app", task: "vl-7", seq: 2 },
        } as never);
        const rooms = yield* roomsWhen(peer.status, (next) => next?.seqs.acme?.app?.["vl-7"] === 2);
        assert.isDefined(rooms);
      }),
    ),
  );

  it.effect("a delivery's move reaches the status on its ping, with no new message", () =>
    run(
      Effect.gen(function* () {
        const current = roomHubOf();
        current.inbox = {
          ...current.inbox,
          seqs: { app: { "vl-7": 2 } },
          revs: { app: { "vl-7": 2 } },
        };
        const peer = yield* roomPeer(current);
        yield* roomsWhen(peer.status, (next) => next?.revs.acme?.app?.["vl-7"] === 2);
        current.inbox = { ...current.inbox, revs: { app: { "vl-7": 3 } } };
        const { hubChanges } = yield* contributionsOf(peer);
        yield* hubChanges!.onPing({
          workspace: "acme",
          change: "rooms",
          origin: null,
          data: { project: "app", task: "vl-7", seq: 2 },
        } as never);
        const rooms = yield* roomsWhen(peer.status, (next) => next?.revs.acme?.app?.["vl-7"] === 3);
        assert.strictEqual(rooms?.seqs.acme?.app?.["vl-7"], 2);
      }),
    ),
  );

  it.effect("leaves nothing from a Hub that has no inbox route yet", () =>
    run(
      Effect.gen(function* () {
        const peer = yield* roomPeer(
          roomHubOf({
            route: (_method, url) =>
              url.includes("/rooms/inbox")
                ? [404, { error: { code: "not_found", message: "no such route" } }]
                : undefined,
          }),
        );
        const rooms = yield* roomsWhen(peer.status, (next) => next !== undefined);
        assert.deepStrictEqual(rooms, {
          waiting: [],
          mentions: [],
          seqs: {},
          revs: {},
          shareWork: false,
          rooms: {},
        });
      }),
    ),
  );
});

describe("leaving a workspace", () => {
  it("clears that workspace's jobs and no other's", () => {
    const heard = (workspace: string) => ({
      kind: "heard" as const,
      place: { workspace, project: "app", task: "vl-7" },
      seq: 1,
      run: "run_1",
    });
    const read = { kind: "read" as const, workspace: "other" };
    assert.deepStrictEqual(
      jobsAfterLeaving(
        [heard("acme"), read, heard("other"), { ...read, workspace: "acme" }],
        "acme",
      ),
      [read, heard("other")],
    );
  });
});

describe("a heard move", () => {
  it.effect("the Hub did not take is sent again with the next read", () =>
    run(
      Effect.gen(function* () {
        let down = true;
        const current = roomHubOf({
          route: (method, url) =>
            method === "PATCH" && url.includes("/deliveries/")
              ? down
                ? [503, { error: { code: "down", message: "Not now." } }]
                : [200, { message: messageOf() }]
              : undefined,
        });
        const peer = yield* roomPeer(current);
        const moves = () => callsTo(peer, "PATCH", "/deliveries/").length;
        const { hooks, hubChanges } = yield* contributionsOf(peer);
        yield* hooks!.delivery!({
          session: sessionOf(),
          refs: ["vl-7:12"],
          state: "modelInput",
        } as never);
        yield* waitFor(() => moves() > 0);
        const first = moves();
        down = false;
        yield* hubChanges!.onPing({
          workspace: "acme",
          change: "rooms",
          origin: null,
          data: { project: "app", task: "vl-7", seq: 12 },
        } as never);
        yield* waitFor(() => moves() > first);
        assert.deepInclude(bodyOf(callsTo(peer, "PATCH", "/deliveries/").at(-1)) as object, {
          move: "heard",
          run: "run_1",
        });
      }),
    ),
  );
});

describe("marking a room seen", () => {
  it.effect("reads the inbox again, so a mention leaves Needs you", () =>
    run(
      Effect.gen(function* () {
        const need = { project: "app", task: "vl-7", message: messageOf({ to: [] }) };
        const current = roomHubOf();
        current.inbox = { ...current.inbox, mentions: [need] };
        const peer = yield* roomPeer(current);
        yield* roomsWhen(peer.status, (rooms) => rooms?.mentions.length === 1);
        current.inbox = { ...current.inbox, mentions: [] };
        yield* rpc(peer, "peer.rooms.seen", { ...place, seq: 12 });
        yield* roomsWhen(peer.status, (rooms) => rooms?.mentions.length === 0);
      }),
    ),
  );
});

describe("a delivery its owner sent on again", () => {
  const url = `${ROOM}/12/deliveries/${encodeURIComponent(BOB)}`;

  const gitIn = (cwd: string, ...args: ReadonlyArray<string>) =>
    NodeChildProcess.execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Bob",
        GIT_AUTHOR_EMAIL: BOB,
        GIT_COMMITTER_NAME: "Bob",
        GIT_COMMITTER_EMAIL: BOB,
      },
    });

  /** The project's checkout and a task's worktree of it, on a branch with nothing on it yet. */
  const repository = Effect.acquireRelease(
    Effect.sync(() => {
      const directory = NodeFS.realpathSync(
        NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "peer-retry-")),
      );
      const project = NodePath.join(directory, "project");
      NodeFS.mkdirSync(project);
      gitIn(project, "init", "--quiet", "--initial-branch=main");
      gitIn(project, "commit", "--quiet", "--allow-empty", "-m", "start");
      const tree = NodePath.join(directory, "tree");
      gitIn(project, "worktree", "add", "--quiet", "-b", "feature/vl-7", tree, "main");
      return { directory, project, tree };
    }),
    ({ directory }) =>
      Effect.sync(() => NodeFS.rmSync(directory, { recursive: true, force: true })),
  );

  const commitIn = (tree: string) => {
    NodeFS.writeFileSync(NodePath.join(tree, "total.ts"), "1\n");
    gitIn(tree, "add", ".");
    gitIn(tree, "commit", "--quiet", "-m", "the work");
  };

  type Launch = Parameters<PeerTaskLauncher["launch"]>[0];

  /** Bob's Peer over a stand-in for herdr's launcher, with one run of his that left `tree`. */
  const retried = (project: string, tree: string, chat = false) =>
    Effect.gen(function* () {
      const launched: Array<Launch> = [];
      const created: Array<PeerLifecycleEvent> = [];
      const made = (worktrees: string) => NodePath.join(worktrees, "VL-7-new");
      const contributions: PeerContributions = {
        taskWorktreeCreated: (event) => Effect.sync(() => void created.push(event)),
        taskLauncher: {
          unavailable: Effect.succeed(null),
          launch: (asked: Launch) =>
            Effect.sync(() => {
              launched.push(asked);
              return {
                paneId: "pane-9",
                terminalId: "term-9",
                threadKey: "herdr:term-9",
                root: asked.reuse ?? made(asked.worktrees),
                ...(asked.reuse === undefined
                  ? { worktree: { root: made(asked.worktrees), identity: "1:2" } }
                  : {}),
                alsoTrees: (asked.also ?? []).map((other) => ({
                  root: made(other.worktrees),
                  identity: "3:4",
                })),
              };
            }),
        },
      };
      const herdr = bindPlugin({
        id: "herdr",
        title: "herdr",
        summary: "test",
        defaultEnabled: true,
        layer: Layer.empty,
        make: Effect.succeed(contributions),
      });
      const current = roomHubOf();
      const peer = yield* roomPeer(current, [herdr]);
      yield* peer.state.updatePersisted((persisted) => ({
        ...persisted,
        localCheckouts: { "acme/app/api": project },
      }));
      if (chat)
        yield* peer.state.updateRuntime((runtime) => ({
          ...runtime,
          work: new Map([
            ["acme/app", { areas: [], tasks: [{ ...TASK, chat: true }], threads: [] }],
          ]),
        }));
      const { book } = peer.runs;
      const first = yield* Effect.promise(() =>
        book.create({
          workspace: "acme",
          project: "app",
          task: "vl-7",
          agent: "claude",
          runtime: "herdr",
        }),
      );
      yield* Effect.promise(() => book.hold(first.run.id, "herdr:term-1", "pane-1", tree));
      return { current, peer, first: first.run.id, launched, created };
    });

  /** The next read of the inbox finds `message` to carry. */
  const sendOn = (
    peer: Peer,
    current: ReturnType<typeof roomHubOf>,
    message: ReturnType<typeof messageOf>,
  ) =>
    Effect.gen(function* () {
      current.inbox = {
        ...current.inbox,
        work: [{ project: "app", task: "vl-7", message }],
      };
      yield* rpc(peer, "peer.rooms.seen", { ...place, seq: 12 });
    });

  /** The start is over: the run it made is on the delivery. */
  const startedRun = (peer: Peer) =>
    waitFor(() =>
      callsTo(peer, "PATCH", url).some((call) => {
        const body = bodyOf(call) as { readonly expect?: string };
        return body.expect === "taken";
      }),
    );

  it.effect("goes on with an open run that left work, on its model, and starts none", () =>
    run(
      Effect.gen(function* () {
        const { project, tree } = yield* repository;
        commitIn(tree);
        const { current, peer, first, launched } = yield* retried(project, tree);
        yield* sendOn(
          peer,
          current,
          messageOf({
            author: { email: BOB },
            to: [{ kind: "agent", email: BOB, state: "passed", by: BOB, model: "claude-opus-5-5" }],
          }),
        );
        yield* waitFor(() => callsTo(peer, "PATCH", url).length > 0);
        assert.deepStrictEqual(bodyOf(callsTo(peer, "PATCH", url)[0]), {
          move: "take",
          environment: TEST_ENVIRONMENT,
          run: first,
          expect: "passed",
        });
        assert.deepStrictEqual(launched, []);
      }),
    ),
  );

  it.effect("starts a run in the checkout an ended run left work in", () =>
    run(
      Effect.gen(function* () {
        const { project, tree } = yield* repository;
        commitIn(tree);
        const { current, peer, first, launched } = yield* retried(project, tree);
        yield* Effect.promise(() => peer.runs.book.end(first, "handed-off"));
        yield* sendOn(
          peer,
          current,
          messageOf({ to: [{ kind: "agent", email: BOB, state: "passed", by: BOB }] }),
        );
        yield* waitFor(() => launched.length > 0);
        assert.strictEqual(launched[0]!.reuse, tree);
        const started = launched[0]!.env.PEER_RUN!;
        assert.notStrictEqual(started, first);
        yield* waitFor(() => peer.runs.book.get(started)?.root !== undefined);
        assert.strictEqual(peer.runs.book.get(started)!.root, tree);
      }),
    ),
  );

  it.effect("starts from the base where the ended run left nothing", () =>
    run(
      Effect.gen(function* () {
        const { project, tree } = yield* repository;
        const { current, peer, first, launched } = yield* retried(project, tree);
        yield* Effect.promise(() => peer.runs.book.end(first, "handed-off"));
        yield* sendOn(
          peer,
          current,
          messageOf({ to: [{ kind: "agent", email: BOB, state: "passed", by: BOB }] }),
        );
        yield* waitFor(() => launched.length > 0);
        assert.isUndefined(launched[0]!.reuse);
      }),
    ),
  );

  it.effect("reports the checkout a start made, once", () =>
    run(
      Effect.gen(function* () {
        const { project, tree } = yield* repository;
        const { current, peer, first, launched, created } = yield* retried(project, tree);
        yield* Effect.promise(() => peer.runs.book.end(first, "handed-off"));
        yield* sendOn(
          peer,
          current,
          messageOf({ to: [{ kind: "agent", email: BOB, state: "passed", by: BOB }] }),
        );
        yield* startedRun(peer);
        assert.deepStrictEqual(created, [
          {
            kind: "task-worktree-created",
            workspace: "acme",
            project: "app",
            repository: "api",
            task: "vl-7",
            thread: "herdr:term-9",
            root: NodePath.join(launched[0]!.worktrees, "VL-7-new"),
            identity: "1:2",
          },
        ]);
      }),
    ),
  );

  it.effect("reports no checkout where a start goes on in the one a run left", () =>
    run(
      Effect.gen(function* () {
        const { project, tree } = yield* repository;
        commitIn(tree);
        const { current, peer, first, launched, created } = yield* retried(project, tree);
        yield* Effect.promise(() => peer.runs.book.end(first, "handed-off"));
        yield* sendOn(
          peer,
          current,
          messageOf({ to: [{ kind: "agent", email: BOB, state: "passed", by: BOB }] }),
        );
        yield* startedRun(peer);
        assert.strictEqual(launched[0]!.reuse, tree);
        assert.deepStrictEqual(created, []);
      }),
    ),
  );

  it.effect("reports a shared room's other checkout under its own project and task", () =>
    run(
      Effect.gen(function* () {
        const { project, tree } = yield* repository;
        const { current, peer, first, launched, created } = yield* retried(project, tree);
        yield* Effect.promise(() => peer.runs.book.end(first, "handed-off"));
        yield* peer.state.updatePersisted((persisted) => ({
          ...persisted,
          localCheckouts: { ...persisted.localCheckouts, "acme/web/api": project },
          workspaces: persisted.workspaces.map((workspace) => ({
            ...workspace,
            manifest: {
              ...workspace.manifest!,
              projects: [
                ...workspace.manifest!.projects,
                { ...workspace.manifest!.projects[0]!, id: "web", name: "Web" },
              ],
            },
          })),
        }));
        yield* peer.state.updateRuntime((runtime) => ({
          ...runtime,
          work: new Map([
            [
              "acme/app",
              { areas: [], tasks: [{ ...TASK, chat: true, group: "both" }], threads: [] },
            ],
            [
              "acme/web",
              { areas: [], tasks: [{ ...TASK, id: "vl-8", group: "both" }], threads: [] },
            ],
          ]),
        }));
        yield* sendOn(
          peer,
          current,
          messageOf({
            author: { email: BOB },
            to: [{ kind: "agent", email: BOB, state: "passed" }],
          }),
        );
        yield* startedRun(peer);
        assert.deepStrictEqual(
          created.map((event) =>
            event.kind === "task-worktree-created"
              ? [event.project, event.task, event.root, event.identity]
              : [],
          ),
          [
            ["app", "vl-7", NodePath.join(launched[0]!.worktrees, "VL-7-new"), "1:2"],
            ["web", "vl-8", NodePath.join(launched[0]!.also![0]!.worktrees, "VL-7-new"), "3:4"],
          ],
        );
      }),
    ),
  );

  it.effect("leaves a person's next message in a chat to a new checkout", () =>
    run(
      Effect.gen(function* () {
        const { project, tree } = yield* repository;
        commitIn(tree);
        const { current, peer, first, launched } = yield* retried(project, tree, true);
        yield* Effect.promise(() => peer.runs.book.end(first, "handed-off"));
        yield* sendOn(
          peer,
          current,
          messageOf({
            author: { email: BOB },
            to: [{ kind: "agent", email: BOB, state: "passed" }],
          }),
        );
        yield* waitFor(() => launched.length > 0);
        assert.isUndefined(launched[0]!.reuse);
      }),
    ),
  );

  it.effect("shows what a run that ended left in its checkout, in the room's diff", () =>
    run(
      Effect.gen(function* () {
        const { project, tree } = yield* repository;
        commitIn(tree);
        const { peer, first } = yield* retried(project, tree);
        yield* Effect.promise(() => peer.runs.book.end(first, "handed-off"));
        const diff = (yield* rpc(peer, "peer.rooms.diff", place)) as PeerRoomDiff;
        assert.strictEqual(diff.state, "here");
        assert.strictEqual(diff.folder, tree);
        if (diff.state === "here") assert.include(diff.patch, "total.ts");
      }),
    ),
  );
});

describe("a session that leaves", () => {
  const url = `${ROOM}/12/deliveries/${encodeURIComponent(BOB)}`;
  const reads = (peer: Peer) => callsTo(peer, "GET", "/rooms/inbox").length;
  const ending = (over: Parameters<typeof sessionOf>[0] = {}) => ({
    session: sessionOf(over),
    event: "session-end" as const,
    remainingMs: 1000,
  });

  /** Bob's Peer past the start grace, with a delivery that `run_1` took and no read since. */
  const taken = Effect.gen(function* () {
    const current = roomHubOf();
    const peer = yield* roomPeer(current);
    yield* waitFor(() => reads(peer) > 0);
    yield* TestClock.adjust(PEER_ROOM_START_GRACE_MS);
    current.inbox = {
      ...current.inbox,
      work: [
        {
          project: "app",
          task: "vl-7",
          message: messageOf({
            author: { email: BOB },
            to: [{ kind: "agent", email: BOB, state: "taken", run: "run_1" }],
          }),
        },
      ],
    };
    const { hooks } = yield* contributionsOf(peer);
    return { peer, hooks: hooks! };
  });

  it.effect.each(["sessionEnd", "sessionExpired"] as const)(
    "%s fails what its run took, with no ping or sync",
    (hook) =>
      run(
        Effect.gen(function* () {
          const { peer, hooks } = yield* taken;
          yield* hooks[hook]!(ending());
          yield* TestClock.adjust("3 seconds");
          yield* waitFor(() => callsTo(peer, "PATCH", url).length > 0);
          assert.deepStrictEqual(bodyOf(callsTo(peer, "PATCH", url)[0]), {
            move: "fail",
            environment: TEST_ENVIRONMENT,
            reason: "The agent is no longer running.",
          });
        }),
      ),
  );

  it.effect("gives a session that only restarts a moment to come back", () =>
    run(
      Effect.gen(function* () {
        const { peer, hooks } = yield* taken;
        const before = reads(peer);
        yield* hooks.sessionEnd!(ending());
        yield* TestClock.adjust("2 seconds");
        yield* TestClock.withLive(Effect.sleep("20 millis"));
        assert.strictEqual(reads(peer), before);
        yield* TestClock.adjust("1 second");
        yield* waitFor(() => reads(peer) > before);
      }),
    ),
  );

  it.effect("reads nothing for a session of no run", () =>
    run(
      Effect.gen(function* () {
        const { peer, hooks } = yield* taken;
        const before = reads(peer);
        const event = ending();
        const { run: _run, ...session } = event.session;
        yield* hooks.sessionEnd!({ ...event, session });
        yield* TestClock.adjust("3 seconds");
        yield* TestClock.withLive(Effect.sleep("20 millis"));
        assert.strictEqual(reads(peer), before);
      }),
    ),
  );
});

describe("work assigned to this computer", () => {
  it.effect("fails a passed message without a checkout, saying so in the room", () =>
    run(
      Effect.gen(function* () {
        const url = `${ROOM}/12/deliveries/${encodeURIComponent(BOB)}`;
        let moved = 0;
        let bothMoves = () => {};
        const both = new Promise<void>((resolve) => {
          bothMoves = resolve;
        });
        const current = roomHubOf({
          route: (method, called) => {
            if (method !== "PATCH" || !called.includes(url)) return undefined;
            moved += 1;
            if (moved === 2) bothMoves();
            return [200, { message: messageOf() }];
          },
        });
        current.inbox = {
          ...current.inbox,
          work: [
            {
              project: "app",
              task: "vl-7",
              message: messageOf({
                author: { email: BOB },
                to: [{ kind: "agent", email: BOB, state: "passed" }],
              }),
            },
          ],
        };
        const peer = yield* roomPeer(current);
        yield* Effect.promise(() => both);
        const moves = callsTo(peer, "PATCH", url).map(bodyOf);
        assert.deepStrictEqual(moves, [
          { move: "take", environment: TEST_ENVIRONMENT, expect: "passed" },
          {
            move: "fail",
            environment: TEST_ENVIRONMENT,
            reason: "This computer has no checkout of the project.",
          },
        ]);
      }),
    ),
  );
});
