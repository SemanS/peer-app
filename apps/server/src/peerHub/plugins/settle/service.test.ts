// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalDateInEffect:off - the register on disk; the broker's notes carry wall-clock times.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { isSettleHandover, settleHandover, type PeerHubStatus } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { brokerFixture } from "../../core/broker/testkit.ts";
import type { CoordinationBroker } from "../../core/broker/Broker.ts";
import { NO_PLUGINS, type NativeResumeOutcome } from "../../core/broker/host.ts";
import { PeerAgents } from "../../core/coordination/PeerAgents.ts";
import type { HubCoordSession, HubOverlap } from "../../core/hub/coordApi.ts";
import type { PeerSessionEndingContext, PeerSessionView } from "../../core/plugin.ts";
import { PeerStatus } from "../../core/status/PeerStatus.ts";
import {
  coreLayer,
  seedState,
  signedInSeed,
  standInHub,
  type HubAnswer,
} from "../../core/testkit.ts";
import { make, SettleResumer, SETTLE_WINDOW_MS } from "./service.ts";

const OVERLAP = "abc123def456";
const coordination: PeerHubStatus["coordination"] = {
  enabled: true,
  policy: "coordinate",
  claudeHooks: false,
  logPath: "",
  sessions: [],
  overlaps: [],
  findings: [],
  contexts: [],
  candidates: [],
};

interface Resumed {
  readonly agent: string;
  readonly nativeId: string;
  readonly text: string;
}

/**
 * Ana's Claude Code session `claude:one` and Vir's `claude:vir` on one overlap, under a broker of
 * fakes over core's real services, with a stand-in Hub and a stand-in CLI that does what `act`
 * says when Peer resumes a conversation.
 */
const setup = (
  options: {
    readonly virWrote?: boolean;
    readonly virAtWork?: boolean;
    readonly hubDown?: { current: boolean };
    /** False: the plugin does not hear the broker's session ends. */
    readonly hears?: boolean;
  } = {},
) =>
  Effect.gen(function* () {
    const hubDown = options.hubDown ?? { current: false };
    const answer: { current: HubAnswer } = {
      current: (url) =>
        url.includes("/notes")
          ? hubDown.current
            ? [503, { error: "unavailable" }]
            : [200, { id: OVERLAP }]
          : [404, { error: "no such route" }],
    };
    const hub = yield* standInHub(answer);
    const base = yield* seedState(signedInSeed(hub.url));
    const now = new Date().toISOString();
    const overlap: HubOverlap = {
      id: OVERLAP,
      project: "app",
      sessions: ["claude:one", "claude:vir"],
      files: ["src/pay.ts"],
      state: "open",
      notes: [
        {
          id: "n1",
          session: "claude:one",
          email: "ana@acme.test",
          text: "I change totals",
          at: now,
        },
        ...(options.virWrote === false
          ? []
          : [
              {
                id: "n2",
                session: "claude:vir",
                email: "vir@acme.test",
                text: "Mine too",
                at: now,
              },
            ]),
      ],
      openedAt: now,
      updatedAt: now,
    };
    const vir: HubCoordSession = {
      id: "claude:vir",
      project: "app",
      email: "vir@acme.test",
      environment: "vir-laptop",
      label: "Totals",
      agent: "claude",
      status: "working",
      files: [],
      claims: [],
      seenAt: now,
    };
    const held: { broker?: CoordinationBroker } = {};
    const hubView = () => held.broker!.views.get("acme")!;
    let ending: ((ctx: PeerSessionEndingContext) => Effect.Effect<void>) | undefined;
    const fixture = yield* Effect.acquireRelease(
      Effect.promise(() =>
        brokerFixture(() => ({
          policy: () => "coordinate",
          // The Hub keeps what it has: a sync reads the same overlaps back.
          report: async () => hubView(),
          view: async () => hubView(),
          note: async (_workspace, _project, id, text, session) => {
            const current = hubView().overlaps.find((o) => o.id === id)!;
            const updated: HubOverlap = {
              ...current,
              notes: [
                ...current.notes,
                {
                  id: `n${current.notes.length + 1}`,
                  session,
                  email: "ana@acme.test",
                  text,
                  at: now,
                },
              ],
            };
            return updated;
          },
          plugins: async () => ({
            ...NO_PLUGINS,
            active: [
              {
                id: "settle",
                title: "Settle overlaps",
                contributions: {
                  hooks: {
                    sessionEnding: (ctx) => (options.hears === false ? Effect.void : ending!(ctx)),
                  },
                },
              },
            ],
          }),
        })),
      ),
      (fixture) => Effect.promise(() => fixture.dispose()),
    );
    held.broker = fixture.broker;
    fixture.broker.views.set("acme", {
      sessions: options.virAtWork === true ? [vir] : [],
      overlaps: [overlap],
      at: now,
    });
    yield* Effect.promise(() => fixture.register("one"));
    const resumed: Array<Resumed> = [];
    /** What the resumed agent does; by default it closes nothing and its process ends. */
    const act: { current: (call: Resumed) => Promise<NativeResumeOutcome> } = {
      current: async () => ({ status: "ended", exit: 0 }),
    };
    const core = yield* Layer.build(coreLayer(base, { session: "hub-session" }));
    const build = make.pipe(
      Effect.provideService(SettleResumer, async (agent, nativeId, _cwd, text) => {
        const call = { agent, nativeId, text };
        resumed.push(call);
        return act.current(call);
      }),
      Effect.provide(core),
    );
    const agents = yield* PeerAgents.pipe(Effect.provide(core));
    yield* agents.attach(fixture.broker);
    yield* (yield* PeerStatus.pipe(Effect.provide(core))).coordinationFrom(() =>
      Effect.succeed(coordination),
    );
    const service = yield* build;
    ending = service.ending;
    const end = (id = "one") =>
      Effect.promise(() =>
        fixture.broker["hook"](
          { session_id: id, cwd: fixture.root, hook_event_name: "SessionEnd" },
          {},
        ),
      );
    const handovers = () =>
      hub.calls.filter((call) => call.url?.includes("/notes")).map((call) => JSON.parse(call.body));
    const settle = (service_ = service) =>
      Effect.gen(function* () {
        yield* service_.pass;
        yield* service_.drain;
      });
    /** The resumed agent writes a note as `claude:one` through Peer, as `peer note` does. */
    const answers = async () => {
      await fixture.register("one");
      await fixture.broker.noteFor("claude:one", OVERLAP, "Ana first, then Vir", "op-1");
      await fixture.broker["hook"](
        { session_id: "one", cwd: fixture.root, hook_event_name: "SessionEnd" },
        {},
      );
      return { status: "ended", exit: 0 } as const;
    };
    return {
      fixture,
      service,
      build,
      base,
      end,
      settle,
      resumed,
      act,
      answers,
      handovers,
      hubDown,
      setVir: (atWork: boolean) =>
        fixture.broker.views.set("acme", {
          ...fixture.broker.views.get("acme")!,
          sessions: atWork ? [vir] : [],
        }),
    };
  });

describe("settling an overlap after its agents ended", () => {
  it.live("resumes the closer once with the settle nudge when both wrote and both ended", () =>
    Effect.gen(function* () {
      const t = yield* setup();
      const gate = Promise.withResolvers<void>();
      t.act.current = async () => {
        await gate.promise;
        return t.answers();
      };
      yield* t.end();
      yield* t.service.pass;
      // While it runs, the overlap page can say "Resuming…".
      expect(yield* t.service.read).toEqual({
        resume: true,
        attempts: [
          {
            overlap: OVERLAP,
            workspace: "acme",
            project: "app",
            session: "claude:one",
            since: expect.any(String),
          },
        ],
      });
      gate.resolve();
      yield* t.service.drain;
      expect((yield* t.service.read).attempts).toEqual([]);
      expect(t.resumed).toHaveLength(1);
      expect(t.resumed[0]).toMatchObject({ agent: "claude", nativeId: "one" });
      expect(t.resumed[0]!.text).toContain("the other agent ended and will not answer");
      expect(t.resumed[0]!.text).toContain("Vir's agent");
      expect(t.resumed[0]!.text).toContain("Peer resumed this conversation only to settle");
      expect(t.handovers()).toEqual([]);
      // Its own end after the answer starts nothing again.
      yield* t.settle();
      expect(t.resumed).toHaveLength(1);
      expect((yield* t.service.read).attempts).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("resumes nobody when the other agent never wrote", () =>
    Effect.gen(function* () {
      const t = yield* setup({ virWrote: false });
      yield* t.end();
      yield* t.settle();
      expect(t.resumed).toEqual([]);
      expect(t.handovers()).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("waits while the other agent is at work, and resumes once it ended too", () =>
    Effect.gen(function* () {
      const t = yield* setup({ virAtWork: true });
      yield* t.end();
      yield* t.settle();
      expect(t.resumed).toEqual([]);
      t.setVir(false);
      yield* t.settle();
      expect(t.resumed).toHaveLength(1);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("hands over at once, saying so, when the setting is off", () =>
    Effect.gen(function* () {
      const t = yield* setup();
      yield* t.service.setResume(false);
      expect((yield* t.service.read).resume).toBe(false);
      yield* t.end();
      yield* t.settle();
      expect(t.resumed).toEqual([]);
      expect(t.handovers()).toEqual([
        {
          text: settleHandover({ agent: "Ana's agent", reason: "off" }),
          op: `settle-handover:${OVERLAP}:claude:one`,
        },
      ]);
      expect(isSettleHandover(t.handovers()[0].text)).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("hands an MCP-only session's overlap over, since nothing can resume it", () =>
    Effect.gen(function* () {
      const t = yield* setup({ hears: false });
      yield* t.end();
      const overlap = t.fixture.broker.views.get("acme")!.overlaps[0]!;
      yield* t.service.ending({
        session: {
          id: "claude:one",
          agent: "claude",
          adapter: "mcp",
          thread: undefined,
          cwd: t.fixture.root,
        } as PeerSessionView,
        event: "session-end",
        remainingMs: 1_000,
        overlaps: [{ ...overlap, workspace: "acme", policy: "coordinate", closer: "claude:one" }],
      });
      yield* t.settle();
      expect(t.resumed).toEqual([]);
      expect(t.handovers()[0].text).toContain("no resumption for this adapter");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("drops the entry, spawning nothing, when the person reopened the conversation", () =>
    Effect.gen(function* () {
      const t = yield* setup();
      yield* t.end();
      yield* Effect.promise(() => t.fixture.register("one"));
      yield* t.settle();
      expect(t.resumed).toEqual([]);
      expect(t.handovers()).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live.each([
    [{ status: "failed", exit: 1, reason: "exited with 1" }, "resume failed"],
    [
      {
        status: "failed",
        exit: 1,
        reason: "exited with 1",
        stderr: "No conversation found with session ID: one",
      },
      "conversation not found",
    ],
    [{ status: "timeout", exit: null, reason: "timed out" }, "resume ran out of time"],
    [{ status: "ended", exit: 0 }, "the agent ended again"],
  ] as const)("hands over when the resumption ends without an answer: %s", ([outcome, reason]) =>
    Effect.gen(function* () {
      const t = yield* setup();
      t.act.current = async () => outcome;
      yield* t.end();
      yield* t.settle();
      expect(t.resumed).toHaveLength(1);
      expect(t.handovers().map((note) => note.text)).toEqual([
        expect.stringContaining(`could not be resumed (${reason})`),
      ]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("never resumes a session a second time for the same overlap", () =>
    Effect.gen(function* () {
      const t = yield* setup();
      t.act.current = async () => {
        // The resumed process starts and ends again without a word on the overlap.
        await t.fixture.register("one");
        await t.fixture.broker["hook"](
          { session_id: "one", cwd: t.fixture.root, hook_event_name: "SessionEnd" },
          {},
        );
        return { status: "ended", exit: 0 };
      };
      yield* t.end();
      yield* t.settle();
      yield* t.settle();
      // The person reopens it by hand and it ends once more.
      yield* Effect.promise(() => t.fixture.register("one"));
      yield* t.end();
      yield* t.settle();
      expect(t.resumed).toHaveLength(1);
      expect(t.handovers()).toHaveLength(1);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("still resumes once after Peer restarts inside the window", () =>
    Effect.gen(function* () {
      const t = yield* setup();
      yield* t.end();
      const restarted = yield* t.build;
      yield* t.settle(restarted);
      const again = yield* t.build;
      yield* t.settle(again);
      expect(t.resumed).toHaveLength(1);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("hands over instead of resuming after ten minutes", () =>
    Effect.gen(function* () {
      const t = yield* setup();
      yield* t.end();
      // Peer was not running meanwhile: its register says the session ended eleven minutes ago.
      const file = NodePath.join(t.base, "userdata", "settle.json");
      const register = JSON.parse(yield* Effect.promise(() => NodeFSP.readFile(file, "utf8")));
      register.entries[0].endedAt = new Date(Date.now() - SETTLE_WINDOW_MS - 60_000).toISOString();
      yield* Effect.promise(() => NodeFSP.writeFile(file, JSON.stringify(register)));
      yield* t.settle(yield* t.build);
      expect(t.resumed).toEqual([]);
      expect(t.handovers()[0].text).toContain("resume ran out of time");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("writes the handover on a later pass when the Hub could not be reached", () =>
    Effect.gen(function* () {
      const hubDown = { current: true };
      const t = yield* setup({ hubDown });
      yield* t.service.setResume(false);
      yield* t.end();
      yield* t.settle();
      expect(t.handovers()).toHaveLength(1);
      hubDown.current = false;
      yield* t.settle();
      yield* t.settle();
      // The failed call and the one that was written; nothing after.
      expect(t.handovers()).toHaveLength(2);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("tells the resumed session nothing more of that overlap at its first stop", () =>
    Effect.gen(function* () {
      const t = yield* setup();
      const heard: Array<string> = [];
      t.act.current = async () => {
        await t.fixture.register("one");
        for (const event of ["UserPromptSubmit", "Stop"]) {
          const answer = await t.fixture.broker["hook"](
            { session_id: "one", cwd: t.fixture.root, hook_event_name: event },
            {},
          );
          heard.push(JSON.stringify(answer ?? {}));
        }
        await t.fixture.broker.noteFor("claude:one", OVERLAP, "Ana first", "op-2");
        return { status: "ended", exit: 0 };
      };
      yield* t.end();
      yield* t.settle();
      expect(t.resumed).toHaveLength(1);
      expect(heard[1]).not.toContain(OVERLAP.slice(0, 6));
      // The nudge was its prompt: core does not say it again at its first step.
      expect(heard[0]).not.toContain("the other agent ended and will not answer");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
