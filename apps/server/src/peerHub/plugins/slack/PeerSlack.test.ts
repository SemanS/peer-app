import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, expect, it } from "@effect/vitest";
import { EnvironmentId, PeerHubError } from "@t3tools/contracts";
import { HostProcessHostname } from "@t3tools/shared/hostProcess";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import * as PeerWork from "../../core/work/PeerWork.ts";
import { PeerSlack, layer } from "./PeerSlack.ts";
import { slackLedger } from "./ledger.ts";

const at = (iso: string) => DateTime.makeUnsafe(iso);
const isHubError = Schema.is(PeerHubError);
const ME = "GET /slack/me";
const ASKS = "PUT /slack/asks";
const WITHDRAW = "POST /slack/asks/withdraw";
const INBOX = "GET /slack/inbox?environment=ana-laptop";

/** What `GET /slack/me` says: Ana is linked and, as it stands, wants approvals at once. */
const settled = (over: Record<string, unknown> = {}) => ({
  connected: true,
  team: { id: "T1", name: "Acme" },
  bot: { name: "Peer" },
  link: { slackUser: "U1", name: "ana", linkedAt: "2026-10-10T08:00:00Z" },
  pending: null,
  settings: { enabled: true, delayMinutes: 0, place: "thread", kinds: ["approval"], ...over },
  projects: [{ id: "pay", name: "Payments", mode: "thread" }],
});
/** Ana's thread-1, which waits on request `req-1`. */
const waiting = (request = "req-1") => ({
  id: "thread-1",
  projectId: "t3-pay",
  title: "Split payments",
  providerInstanceId: "claude-1",
  lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: "thread-1" },
  archivedAt: null,
  settledAt: null,
  status: "waiting",
  activeRunId: "run-1",
  activityRunStatus: "waiting",
  latestRunId: "run-1",
  latestRunCompletedAt: null,
  latestUserMessageAt: at("2026-10-10T11:00:00Z"),
  pendingRuntimeRequest: { id: request, kind: "command", createdAt: at("2026-10-10T11:58:00Z") },
  latestVisibleMessage: null,
  pendingBackgroundTasks: [],
});

/** `PeerSlack` over a real ledger file, with a Hub, T3's threads and herdr answering in-process. */
const started = Effect.gen(function* () {
  // The ledger is kept in memory here (its file is tested with the ledger): nothing waits on the disk.
  const slice = yield* Ref.make(Option.none<unknown>());
  const state = Layer.mock(PeerState.PeerState)({
    environmentId: EnvironmentId.make("ana-laptop"),
    lock: Semaphore.makeUnsafe(1),
    workspaces: Effect.succeed([{ slug: "acme" }]),
    pluginData: () => ({
      read: Ref.get(slice),
      update: (f: (current: Option.Option<unknown>) => unknown) =>
        Ref.update(slice, (current) => Option.some(f(current))),
    }),
  } as never);
  /** Each request to the Hub, as `METHOD path`, in order; and each time T3's threads are read. */
  const asked = yield* Queue.unbounded<string>();
  const looked = yield* Queue.unbounded<void>();
  const sent: Array<{ readonly key: string; readonly body: unknown }> = [];
  const now = {
    me: settled() as unknown,
    shells: [waiting()] as ReadonlyArray<unknown>,
    inbox: [] as ReadonlyArray<unknown>,
    open: (): unknown => ({}),
    withdraw: (): unknown => ({}),
    dispatched: [] as Array<unknown>,
  };
  const request = (_schema: unknown, input: { method?: string; path: string; body?: unknown }) =>
    Effect.suspend(() => {
      const key = `${input.method ?? "GET"} ${input.path}`;
      sent.push({ key, body: input.body });
      Queue.offerUnsafe(asked, key);
      const reply =
        key === ME
          ? now.me
          : key === ASKS
            ? now.open()
            : key === WITHDRAW
              ? now.withdraw()
              : key === INBOX
                ? { answers: now.inbox }
                : {};
      return isHubError(reply) ? Effect.fail(reply) : Effect.succeed(reply);
    });
  const core = Layer.mergeAll(
    state,
    Layer.mock(PeerHubClient.PeerHubClient)({
      session: Effect.succeed({ hubUrl: "https://hub.test", session: "phs" }),
      request,
    } as never),
    Layer.mock(PeerStatus.PeerStatus)({ changes: Stream.never }),
    Layer.mock(PeerAgents.PeerAgents)({
      runtimeAgents: Effect.succeed([]),
      lastMessage: () => Effect.void,
      promptRuntime: () => Effect.void,
    } as never),
    Layer.mock(PeerWork.PeerWork)({
      localThreads: Effect.succeed(
        new Map([
          [
            "acme",
            [
              {
                id: "peer:thread-1",
                project: "pay",
                title: "x",
                status: "working",
                source: "peer",
              },
            ],
          ],
        ]),
      ),
      tasks: () => Effect.succeed([]),
    } as never),
  );
  const slack = yield* PeerSlack.pipe(
    Effect.provide(layer.pipe(Layer.provide(core))),
    Effect.provideService(HostProcessHostname, "Ana's MacBook.local"),
  );
  const threads = {
    getShellSnapshot: () =>
      Queue.offer(looked, undefined).pipe(Effect.as({ threads: now.shells } as never)),
    getThreadRecords: () => {
      const id = (now.shells[0] as { pendingRuntimeRequest?: { id: string } } | undefined)
        ?.pendingRuntimeRequest?.id;
      return Effect.succeed({
        runtimeRequests: [{ id, status: "pending", responseCapability: { type: "live" } }],
        turnItems: [{ type: "approval_request", requestId: id, prompt: "Run the migration?" }],
      } as never);
    },
    dispatch: (command: unknown) => Effect.sync(() => void now.dispatched.push(command)) as never,
  };
  slack.bindThreads(threads as never);
  /** Waits until the Hub was asked for `key`. */
  const askedFor = (key: string) =>
    Effect.gen(function* () {
      while ((yield* Queue.take(asked)) !== key);
    });
  const running = Effect.forkScoped(slack.run);
  const bodies = (key: string) => sent.filter((call) => call.key === key).map((call) => call.body);
  const ledger = slackLedger(yield* PeerState.PeerState.pipe(Effect.provide(state)));
  return { slack, now, asked, looked, askedFor, running, bodies, ledger };
});

const OPENING = {
  environment: "ana-laptop",
  waitKey: "peer:thread-1:req:req-1",
  project: "pay",
  subject: {
    key: "peer:thread-1",
    title: "Split payments",
    agent: "Claude",
    computer: "Ana's MacBook",
  },
  kind: "approval",
  text: "Run the migration?",
  decisions: ["accept", "decline"],
};
/** The thread is working again: the approval it waited on is no longer there. */
const working = {
  ...waiting(),
  status: "running",
  activityRunStatus: "running",
  pendingRuntimeRequest: null,
};
/** Lets the loop, parked until the next five seconds, take its next pass. */
const pass = TestClock.adjust("5 seconds");
/** Lets what a ping woke take its turn, then the second the loop keeps between two passes. */
const afterPing = Effect.yieldNow.pipe(
  Effect.andThen(Effect.yieldNow),
  Effect.andThen(TestClock.adjust("1 second")),
);

describe("Slack's loop on this computer", () => {
  it.effect("opens a waiting thread once for a member who wants it at once", () =>
    Effect.gen(function* () {
      const s = yield* started;
      yield* s.running;
      yield* s.askedFor(ASKS);
      yield* s.askedFor(INBOX);
      yield* pass;
      yield* pass;
      yield* pass;
      expect(s.bodies(ASKS)).toEqual([OPENING]);
      expect(s.bodies(ME)).toHaveLength(1);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("waits out the member's delay, checking every few seconds", () =>
    Effect.gen(function* () {
      const s = yield* started;
      s.now.me = settled({ delayMinutes: 2 });
      yield* s.running;
      yield* s.askedFor(INBOX);
      yield* Queue.clear(s.looked);
      yield* TestClock.adjust("1 minute");
      yield* pass;
      yield* Queue.take(s.looked);
      expect(s.bodies(ASKS)).toEqual([]);
      yield* TestClock.adjust("1 minute");
      yield* pass;
      yield* pass;
      yield* s.askedFor(ASKS);
      expect(s.bodies(ASKS)).toEqual([OPENING]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "reads the member's settings and asks for answers again at a ping, and not before",
    () =>
      Effect.gen(function* () {
        const s = yield* started;
        s.now.me = settled({ enabled: false });
        yield* s.running;
        yield* s.askedFor(ME);
        expect(s.bodies(ASKS)).toEqual([]);
        expect(s.bodies(INBOX)).toEqual([]);
        // Ana turns Slack on in another client; the Hub pings.
        s.now.me = settled();
        yield* s.slack.ping("acme");
        yield* afterPing;
        yield* s.askedFor(ASKS);
        yield* s.askedFor(INBOX);
        expect(s.bodies(ME)).toHaveLength(2);
        // Left alone, the settings are read again after ten minutes, and the Hub asked each minute.
        yield* TestClock.adjust("10 minutes");
        yield* pass;
        yield* pass;
        yield* s.askedFor(ME);
        expect(s.bodies(ME)).toHaveLength(3);
        expect(s.bodies(INBOX).length).toBeGreaterThanOrEqual(3);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("stops opening once the Hub says Slack is off for an ask, until the next ping", () =>
    Effect.gen(function* () {
      const s = yield* started;
      s.now.open = () => ({ off: "project-off" });
      yield* s.running;
      yield* s.askedFor(ASKS);
      yield* s.askedFor(INBOX);
      yield* pass;
      yield* pass;
      expect(s.bodies(ASKS)).toEqual([OPENING]);
      // An admin changed the project's mode; the Hub pings, and the ask goes out.
      s.now.open = () => ({});
      yield* s.slack.ping("acme");
      yield* afterPing;
      yield* s.askedFor(ASKS);
      expect(s.bodies(ASKS)).toEqual([OPENING, OPENING]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("opens again, with no ping, once the settings it read again have changed", () =>
    Effect.gen(function* () {
      const s = yield* started;
      s.now.open = () => ({ off: "project-unset" });
      yield* s.running;
      yield* s.askedFor(ASKS);
      yield* s.askedFor(INBOX);
      yield* pass;
      expect(s.bodies(ASKS)).toEqual([OPENING]);
      // An admin set the project's mode and the ping was missed: the next reading shows it.
      s.now.open = () => ({});
      s.now.me = settled({ place: "direct" });
      yield* TestClock.adjust("10 minutes");
      yield* pass;
      yield* pass;
      yield* s.askedFor(ASKS);
      expect(s.bodies(ASKS)).toEqual([OPENING, OPENING]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("tries again each minute for a workspace whose settings it could not read", () =>
    Effect.gen(function* () {
      const s = yield* started;
      s.now.me = new PeerHubError({ detail: "Could not reach the hub." });
      yield* s.running;
      yield* s.askedFor(ME);
      yield* TestClock.adjust("1 minute");
      yield* pass;
      s.now.me = settled();
      yield* TestClock.adjust("1 minute");
      yield* pass;
      yield* s.askedFor(ASKS);
      expect(s.bodies(ASKS)).toEqual([OPENING]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "withdraws an ask whose decision point is over: handled, or ended when the thread is gone",
    () =>
      Effect.gen(function* () {
        const s = yield* started;
        yield* s.running;
        yield* s.askedFor(ASKS);
        s.now.shells = [working];
        yield* pass;
        yield* s.askedFor(WITHDRAW);
        s.now.shells = [waiting("req-2")];
        yield* pass;
        yield* s.askedFor(ASKS);
        s.now.shells = [];
        yield* pass;
        yield* s.askedFor(WITHDRAW);
        expect(s.bodies(WITHDRAW)).toEqual([
          { environment: "ana-laptop", waitKey: "peer:thread-1:req:req-1", reason: "handled" },
          { environment: "ana-laptop", waitKey: "peer:thread-1:req:req-2", reason: "ended" },
        ]);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("takes the owner's answer to the agent and tells the Hub, once", () =>
    Effect.gen(function* () {
      const s = yield* started;
      s.now.inbox = [
        { answer: "a1", waitKey: "peer:thread-1:req:req-1", kind: "decision", value: "accept" },
      ];
      yield* s.running;
      yield* s.askedFor("POST /slack/inbox/a1/result");
      expect(s.now.dispatched).toEqual([
        {
          type: "runtime-request.respond",
          commandId: "slack:a1",
          threadId: "thread-1",
          requestId: "req-1",
          decision: "accept",
        },
      ]);
      expect(s.bodies("POST /slack/inbox/a1/result")).toEqual([{ result: "delivered" }]);
      // The Hub no longer holds it; a later sweep finds nothing to do.
      s.now.inbox = [];
      yield* s.slack.ping("acme");
      yield* afterPing;
      yield* s.askedFor(INBOX);
      expect(s.now.dispatched).toHaveLength(1);
      expect((yield* s.ledger.read).delivered).toEqual({});
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("does nothing once stopped", () =>
    Effect.gen(function* () {
      const s = yield* started;
      const fiber = yield* s.running;
      yield* s.askedFor(ASKS);
      yield* s.askedFor(INBOX);
      yield* Fiber.interrupt(fiber);
      yield* Queue.clear(s.asked);
      s.now.shells = [waiting("req-2")];
      yield* s.slack.ping("acme");
      yield* TestClock.adjust("20 minutes");
      yield* Effect.yieldNow;
      assert.strictEqual(yield* Queue.size(s.asked), 0);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("withdraws what it opened when turned off, and says if the Hub would not take it", () =>
    Effect.gen(function* () {
      const s = yield* started;
      const fiber = yield* s.running;
      yield* s.askedFor(ASKS);
      yield* s.askedFor(INBOX);
      yield* Fiber.interrupt(fiber);
      s.now.withdraw = () => new PeerHubError({ detail: "Could not reach the hub." });
      const failed = yield* s.slack.stop.pipe(Effect.flip);
      assert.include(failed.detail, "1 Slack message(s) could not be withdrawn");
      s.now.withdraw = () => ({});
      yield* s.slack.stop;
      expect(s.bodies(WITHDRAW).at(-1)).toEqual({
        environment: "ana-laptop",
        waitKey: "peer:thread-1:req:req-1",
        reason: "off",
      });
      yield* s.slack.stop;
      expect(s.bodies(WITHDRAW)).toHaveLength(2);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("forgets the workspaces a person left, and everything on signing out", () =>
    Effect.gen(function* () {
      const s = yield* started;
      const entry = (workspace: string) => ({
        workspace,
        firstSeenAt: "2026-10-10T12:00:00.000Z",
        opened: true,
        closed: false,
        occurrence: 1,
      });
      yield* s.ledger.update(() => ({
        waits: { a: entry("acme"), b: entry("other") },
        delivered: {
          d1: { workspace: "acme", result: "delivered" },
          d2: { workspace: "other", result: "stale", reason: "handled" },
        },
      }));
      yield* s.slack.forget({ kind: "synced", workspaces: [{ slug: "acme" }] as never });
      const synced = yield* s.ledger.read;
      assert.deepStrictEqual(Object.keys(synced.waits), ["a"]);
      assert.deepStrictEqual(Object.keys(synced.delivered), ["d1"]);
      yield* s.slack.forget({ kind: "left-workspace", workspace: "acme" });
      assert.deepStrictEqual(yield* s.ledger.read, { waits: {}, delivered: {} });
      yield* s.ledger.update(() => ({ waits: { a: entry("acme") }, delivered: {} }));
      yield* s.slack.forget({ kind: "signing-out" });
      assert.deepStrictEqual(yield* s.ledger.read, { waits: {}, delivered: {} });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
