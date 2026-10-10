import { describe, expect, it } from "@effect/vitest";
import { PeerHubError, type PeerSlackMe } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";

import { PeerPromptStale } from "../../core/plugin.ts";
import { deliverer } from "./deliver.ts";
import type { SlackAnswer } from "./hub.ts";
import type { SlackLedger } from "./ledger.ts";
import type { Slack } from "./publisher.ts";
import type { SlackQuestion, SlackRequest, SlackWait } from "./waits.ts";
import type { Source, SlackThreads, World } from "./world.ts";

type Stored = Effect.Success<SlackLedger["read"]>;

const me: PeerSlackMe = {
  connected: true,
  team: null,
  bot: null,
  link: { slackUser: "U1", name: "ana", linkedAt: "x" },
  pending: null,
  settings: { enabled: true, delayMinutes: 5, place: "thread", kinds: [] },
  projects: [],
};

const wait = (waitKey: string, kind: SlackWait["kind"]): SlackWait => ({
  waitKey,
  subject: { key: "k", title: "t", agent: "Claude", computer: "Mac" },
  kind,
  workspace: "acme",
  project: "webshop",
  title: "t",
  since: "x",
});
const shell = { id: "t1", projectId: "p1" } as never;
const place = { workspace: "acme", project: "webshop" };
const onThread = (key: string, kind: SlackWait["kind"], request?: SlackRequest): Source => ({
  wait: wait(key, kind),
  thread: { shell, place, request },
});
const onAgent = (
  key: string,
  kind: SlackWait["kind"],
  agent: Record<string, unknown> = {},
): Source => ({
  wait: wait(key, kind),
  agent: {
    agent: {
      id: "herdr:claude:s1",
      paneId: "pane-1",
      agent: "claude",
      title: "x",
      status: "done",
      session: "s1",
      turn: 4,
      ...agent,
    },
    place,
  },
});
const approval: SlackRequest = { kind: "approval", requestId: "r1" };
const question = (over: Partial<SlackQuestion> = {}): SlackRequest => ({
  kind: "user_input",
  requestId: "r1",
  questions: [
    {
      id: "q1",
      question: "Which mode?",
      options: [{ label: "Fast", value: "fast" }, { label: "Safe" }],
      ...over,
    },
  ],
});
const answer = (over: Partial<SlackAnswer> = {}): SlackAnswer => ({
  answer: "a1",
  waitKey: "peer:t1:req:r1",
  kind: "decision",
  value: "accept",
  ...over,
});

const KEY = "peer:t1:req:r1";

/** A deliverer over an in-memory ledger, a Hub holding `inbox`, and fakes for T3's threads and herdr. */
const rig = (sources: ReadonlyArray<Source> = [], why: ReturnType<World["why"]> = "handled") =>
  Effect.gen(function* () {
    const stored = yield* Ref.make<Stored>({ waits: {}, delivered: {} });
    const done = {
      dispatched: [] as Array<unknown>,
      sent: [] as Array<unknown>,
      prompted: [] as Array<unknown>,
      reported: [] as Array<[string, unknown]>,
    };
    const now = {
      inbox: [] as ReadonlyArray<SlackAnswer>,
      sources,
      why,
      bound: true,
      report: (): Effect.Effect<unknown, PeerHubError> => Effect.succeed({}),
      dispatch: (): Effect.Effect<unknown, PeerHubError> => Effect.void,
      send: (): Effect.Effect<unknown, PeerHubError> => Effect.void,
      prompt: (): Effect.Effect<void, PeerHubError | PeerPromptStale> => Effect.void,
    };
    const threads = {
      dispatch: (command: unknown) => {
        done.dispatched.push(command);
        return now.dispatch();
      },
      sendToThread: (message: unknown) => {
        done.sent.push(message);
        return now.send();
      },
    } as unknown as SlackThreads;
    const s: Slack = {
      environment: "ana-laptop",
      hub: {
        inbox: () => Effect.succeed({ answers: now.inbox }),
        report: (_workspace: string, id: string, body: object) => {
          done.reported.push([id, body]);
          return now.report();
        },
      } as never,
      ledger: { read: Ref.get(stored), update: (f) => Ref.update(stored, f) },
      world: () =>
        Effect.succeed(
          now.bound
            ? {
                waits: now.sources.map((source) => source.wait),
                sources: new Map(now.sources.map((source) => [source.wait.waitKey, source])),
                why: () => now.why,
              }
            : undefined,
        ),
      threads: () => (now.bound ? threads : undefined),
      agents: {
        promptRuntime: (id: string, text: string, expect?: unknown) => {
          done.prompted.push([id, text, expect]);
          return now.prompt();
        },
      },
      mine: new Map([["acme", me]]),
      paused: new Set(),
    };
    return { s, now, done, stored, sweep: deliverer(s) };
  });

describe("delivering the owner's answers from Slack", () => {
  it.effect("approves or declines the request that is pending, as Peer's panel would", () =>
    Effect.gen(function* () {
      const { now, done, sweep, stored } = yield* rig([onThread(KEY, "approval", approval)]);
      now.inbox = [answer(), answer({ answer: "a2", value: "decline" })];
      yield* sweep;
      expect(done.dispatched).toEqual([
        {
          type: "runtime-request.respond",
          commandId: "slack:a1",
          threadId: "t1",
          requestId: "r1",
          decision: "accept",
        },
        {
          type: "runtime-request.respond",
          commandId: "slack:a2",
          threadId: "t1",
          requestId: "r1",
          decision: "decline",
        },
      ]);
      expect(done.reported).toEqual([
        ["a1", { result: "delivered" }],
        ["a2", { result: "delivered" }],
      ]);
      // The Hub has been told: nothing is kept.
      expect((yield* Ref.get(stored)).delivered).toEqual({});
    }),
  );

  it.effect(
    "answers a question as Peer's panel does: an option by its value or label, words as typed",
    () =>
      Effect.gen(function* () {
        const { now, done, sweep } = yield* rig([onThread(KEY, "question", question())]);
        now.inbox = [
          answer({ answer: "o0", kind: "option", value: "Fast", index: 0 }),
          answer({ answer: "o1", kind: "option", value: "Safe", index: 1 }),
          answer({ answer: "t1", kind: "text", value: "  neither, use the cache \n" }),
        ];
        yield* sweep;
        expect(done.dispatched.map((command) => (command as { answers: unknown }).answers)).toEqual(
          [{ q1: "fast" }, { q1: "Safe" }, { q1: "neither, use the cache" }],
        );
        expect(done.reported.map(([, body]) => body)).toEqual([
          { result: "delivered" },
          { result: "delivered" },
          { result: "delivered" },
        ]);
      }),
  );

  it.effect(
    "refuses what the question cannot take: a button that is not there, words where only buttons go",
    () =>
      Effect.gen(function* () {
        const only = yield* rig([
          onThread(KEY, "question", question({ allowCustomAnswer: false })),
        ]);
        only.now.inbox = [
          answer({ answer: "o9", kind: "option", value: "Slow", index: 9 }),
          answer({ answer: "t1", kind: "text", value: "words" }),
          answer({ answer: "d1" }),
        ];
        yield* only.sweep;
        const several = yield* rig([
          onThread(KEY, "question", {
            kind: "user_input",
            requestId: "r1",
            questions: [
              { id: "a", question: "A?", options: [] },
              { id: "b", question: "B?", options: [] },
            ],
          }),
        ]);
        several.now.inbox = [answer({ answer: "t2", kind: "text", value: "words" })];
        yield* several.sweep;
        expect(only.done.dispatched).toEqual([]);
        expect(several.done.dispatched).toEqual([]);
        expect(only.done.reported.map(([, body]) => body)).toEqual([
          { result: "failed", reason: "unsupported" },
          { result: "failed", reason: "unsupported" },
          { result: "failed", reason: "unsupported" },
        ]);
        expect(several.done.reported.map(([, body]) => body)).toEqual([
          { result: "failed", reason: "unsupported" },
        ]);
      }),
  );

  it.effect("approves only for an answer that says accept or decline", () =>
    Effect.gen(function* () {
      const { now, done, sweep } = yield* rig([onThread(KEY, "approval", approval)]);
      now.inbox = [
        answer({ answer: "d1", value: "acceptForSession" }),
        answer({ answer: "t1", kind: "text", value: "yes" }),
      ];
      yield* sweep;
      expect(done.dispatched).toEqual([]);
      expect(done.reported.map(([, body]) => body)).toEqual([
        { result: "failed", reason: "unsupported" },
        { result: "failed", reason: "unsupported" },
      ]);
    }),
  );

  it.effect("sends the owner's words as one user message of a Peer thread that finished", () =>
    Effect.gen(function* () {
      const key = "peer:t1:run:run-1";
      const { now, done, sweep } = yield* rig([onThread(key, "finished")]);
      now.inbox = [answer({ waitKey: key, kind: "text", value: "run the migration first" })];
      yield* sweep;
      expect(done.sent).toEqual([
        {
          projectId: "p1",
          threadId: "t1",
          commandId: "slack:a1",
          messageId: "slack:a1",
          text: "run the migration first",
          attachments: [],
          mode: "auto",
          createdBy: "user",
          creationSource: "server",
        },
      ]);
      expect(done.reported).toEqual([["a1", { result: "delivered" }]]);
    }),
  );

  it.effect("types into a herdr agent only as the session and turn that were read", () =>
    Effect.gen(function* () {
      const key = "herdr:claude:s1:done:4";
      const { now, done, sweep } = yield* rig([onAgent(key, "finished")]);
      // The Hub knows the second time the key came as `#2`.
      now.inbox = [answer({ waitKey: `${key}#2`, kind: "text", value: "run the migration first" })];
      yield* sweep;
      expect(done.prompted).toEqual([
        ["herdr:claude:s1", "run the migration first", { session: "s1", turn: 4 }],
      ]);
      expect(done.reported).toEqual([["a1", { result: "delivered" }]]);
    }),
  );

  it.effect("reports stale, and delivers nothing, to a decision point that is over", () =>
    Effect.gen(function* () {
      for (const why of ["handled", "moved-on", "ended"] as const) {
        const { now, done, sweep } = yield* rig([], why);
        now.inbox = [
          answer(),
          answer({ answer: "a2", waitKey: "herdr:claude:s1:done:4", kind: "text", value: "go" }),
        ];
        yield* sweep;
        expect(done.reported.map(([, body]) => body)).toEqual([
          { result: "stale", reason: why },
          { result: "stale", reason: why },
        ]);
        expect([done.dispatched, done.sent, done.prompted]).toEqual([[], [], []]);
      }
    }),
  );

  it.effect("reports stale when herdr says the agent is not the one that was read", () =>
    Effect.gen(function* () {
      const key = "herdr:claude:s1:done:4";
      for (const [reason, stale] of [
        ["session", "moved-on"],
        ["turn", "moved-on"],
        ["busy", "moved-on"],
        ["gone", "ended"],
      ] as const) {
        const { now, done, sweep } = yield* rig([onAgent(key, "finished")]);
        now.prompt = () => Effect.fail(new PeerPromptStale({ reason }));
        now.inbox = [answer({ waitKey: key, kind: "text", value: "go on" })];
        yield* sweep;
        expect(done.reported).toEqual([["a1", { result: "stale", reason: stale }]]);
      }
    }),
  );

  it.effect("fails what Slack cannot do to a terminal, and what the runtime would not take", () =>
    Effect.gen(function* () {
      const key = "herdr:claude:s1:done:4";
      const blocked = yield* rig([
        onAgent("herdr:claude:s1:blocked:4", "blocked", { status: "blocked" }),
      ]);
      blocked.now.inbox = [
        answer({ waitKey: "herdr:claude:s1:blocked:4", kind: "text", value: "yes" }),
      ];
      yield* blocked.sweep;
      const unknown = yield* rig([onAgent(key, "finished", { turn: undefined })]);
      unknown.now.inbox = [answer({ waitKey: key, kind: "text", value: "go" })];
      yield* unknown.sweep;
      const refused = yield* rig([onAgent(key, "finished")]);
      refused.now.prompt = () => Effect.fail(new PeerHubError({ detail: "no" }));
      refused.now.inbox = [answer({ waitKey: key, kind: "text", value: "go" })];
      yield* refused.sweep;
      expect(blocked.done.reported[0]?.[1]).toEqual({ result: "failed", reason: "unsupported" });
      expect(unknown.done.prompted).toEqual([]);
      expect(unknown.done.reported[0]?.[1]).toEqual({ result: "failed", reason: "unsupported" });
      expect(refused.done.reported[0]?.[1]).toEqual({ result: "failed", reason: "error" });
    }),
  );

  it.effect("reports a failed delivery as failed", () =>
    Effect.gen(function* () {
      const { now, done, sweep } = yield* rig([onThread(KEY, "approval", approval)]);
      now.dispatch = () =>
        Effect.fail(new PeerHubError({ detail: "Runtime request r1 is resolved." }));
      now.inbox = [answer()];
      yield* sweep;
      expect(done.reported).toEqual([["a1", { result: "failed", reason: "error" }]]);
    }),
  );

  it.effect("keeps what became of an answer until the Hub has it, and never delivers twice", () =>
    Effect.gen(function* () {
      const { s, now, done, sweep, stored } = yield* rig([onThread(KEY, "approval", approval)]);
      now.inbox = [answer()];
      // The Hub cannot be reached when the result is reported.
      now.report = () => Effect.fail(new PeerHubError({ detail: "Could not reach the hub." }));
      yield* sweep;
      expect((yield* Ref.get(stored)).delivered["a1"]).toEqual({
        workspace: "acme",
        result: "delivered",
      });
      // The approval is resolved by the delivery itself: the world no longer has the decision point.
      now.sources = [];
      now.why = "handled";
      now.report = () => Effect.succeed({});
      yield* deliverer(s);
      expect(done.dispatched).toHaveLength(1);
      expect(done.reported).toEqual([
        ["a1", { result: "delivered" }],
        ["a1", { result: "delivered" }],
      ]);
      expect((yield* Ref.get(stored)).delivered).toEqual({});
    }),
  );

  it.effect("forgets an answer the Hub refuses to take a report of", () =>
    Effect.gen(function* () {
      const { now, sweep, stored } = yield* rig([onThread(KEY, "approval", approval)]);
      now.inbox = [answer()];
      now.report = () =>
        Effect.fail(new PeerHubError({ detail: "gone", code: "not_found", refused: true }));
      yield* sweep;
      expect((yield* Ref.get(stored)).delivered).toEqual({});
    }),
  );

  it.effect(
    "decides nothing while T3's threads cannot be read, and asks only where Slack is on",
    () =>
      Effect.gen(function* () {
        const { s, now, done, sweep, stored } = yield* rig([onThread(KEY, "approval", approval)]);
        now.inbox = [answer()];
        now.bound = false;
        yield* sweep;
        expect(done.reported).toEqual([]);
        expect((yield* Ref.get(stored)).delivered).toEqual({});
        now.bound = true;
        for (const quiet of [
          { ...me, link: null },
          { ...me, settings: { ...me.settings, enabled: false } },
        ]) {
          s.mine.set("acme", quiet);
          yield* sweep;
        }
        expect(done.reported).toEqual([]);
        expect(done.dispatched).toEqual([]);
      }),
  );
});
