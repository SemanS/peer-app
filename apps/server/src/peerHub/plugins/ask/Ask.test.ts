// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off - a broker in a temporary checkout, and the conversation a stand-in hub opens now.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { PeerHubError } from "@t3tools/contracts";
import { assert, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { PeerBrokerHost } from "../../core/broker/host.ts";
import { brokerFixture, pluginsOf } from "../../core/broker/testkit.ts";
import * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import type { HubCoordSession, HubCoordView, HubOverlap } from "../../core/hub/coordApi.ts";
import * as PeerIndex from "../../core/index/PeerIndex.ts";
import * as PeerPlugins from "../../core/plugins/PeerPlugins.ts";
import { coreLayer, seedState } from "../../core/testkit.ts";
import { AskPlugin } from "./index.ts";

const QUESTION = "Where do you keep the speaker names?";
const AS_ONE = { "x-peer-session": "claude:one" };

/** Lets the work already in flight finish (a macrotask passes). */
const settled = Effect.promise(() => new Promise<void>((resolve) => setImmediate(resolve)));

/**
 * acme's app project, where Vir's agent works on KRK-2 on another computer. Once Ana's agent
 * `one` claims that task, the hub opens a conversation between the two, keeps the notes written
 * there, and settles it when `scene.resolved` says so.
 */
const virOnSpeakers = () => {
  const at = new Date().toISOString();
  const vir: HubCoordSession = {
    id: "claude:vir",
    project: "app",
    email: "vir@acme.test",
    environment: "vir-laptop",
    label: "Speakers can be named",
    agent: "claude",
    task: "task-2",
    status: "working",
    files: [],
    claims: [],
    seenAt: at,
  };
  const scene = {
    opened: false,
    resolved: false,
    notes: [] as Array<{ readonly session: string; readonly text: string }>,
  };
  const conversation = (): HubOverlap => ({
    id: "conversation-1",
    project: "app",
    sessions: ["claude:one", "claude:vir"],
    files: ["task:task-2"],
    state: scene.resolved ? "resolved" : "open",
    notes: scene.notes.map((note, index) => ({
      id: `note-${index}`,
      session: note.session,
      email: note.session === "claude:vir" ? "vir@acme.test" : "ana@acme.test",
      text: note.text,
      at,
    })),
    openedAt: at,
    updatedAt: at,
  });
  const view = (): HubCoordView => ({
    sessions: [vir],
    overlaps: scene.opened ? [conversation()] : [],
    at,
  });
  const host: Partial<PeerBrokerHost> = {
    tasks: () => [{ id: "task-2", key: "KRK-2", title: "Speakers", status: "open" }],
    taskName: (_workspace, _project, task) => (task === "task-2" ? "KRK-2 · Speakers" : task),
    report: async (_workspace, sessions) => {
      scene.opened ||= sessions.some((session) => session.claims.includes("task:task-2"));
      return view();
    },
    view: async () => view(),
    note: async (_workspace, _project, _overlap, text, session) => {
      scene.notes.push({ session: session ?? "person", text });
      return conversation();
    },
  };
  return { scene, host };
};

/** Ana's Peer with the ask plugin, and a broker in acme's app checkout, over `host`'s hub. */
const anaWithAsk = (host: Partial<PeerBrokerHost>) =>
  Effect.gen(function* () {
    const core = yield* Layer.build(coreLayer(yield* seedState(), { plugins: [AskPlugin] }));
    return yield* Effect.gen(function* () {
      yield* PeerPlugins.startPlugins;
      const plugins = yield* PeerPlugins.PeerPlugins;
      const fixture = yield* Effect.acquireRelease(
        Effect.promise(() => brokerFixture(() => ({ ...host, ...pluginsOf(plugins) }))),
        (made) => Effect.promise(() => made.dispose()),
      );
      yield* (yield* PeerAgents.PeerAgents).attach(fixture.broker);
      yield* (yield* PeerIndex.PeerIndex).attach(fixture.broker);
      yield* Effect.promise(() => fixture.register("one"));
      const run = (command: string, args: ReadonlyArray<string> = []) =>
        Effect.promise(() => fixture.broker["runCli"](command, args, AS_ONE));
      return {
        fixture,
        plugins,
        run,
        claims: () => fixture.broker["sessions"].get("claude:one")?.claims ?? [],
        sync: Effect.promise(() => fixture.broker["syncNow"]("acme", 3000)),
      };
    }).pipe(Effect.provide(core));
  });

describe("peer ask", () => {
  it.effect(
    "rejects missing, unknown, own and non-task targets, and nobody at work, without claims or notes",
    () =>
      Effect.gen(function* () {
        const { scene, host } = virOnSpeakers();
        const ana = yield* anaWithAsk(host);
        yield* Effect.promise(async () => {
          for (const args of [[], ["unknown", QUESTION], ["project", QUESTION]])
            await expect(ana.fixture.broker.runCli("ask", args, AS_ONE)).rejects.toMatchObject({
              outcome: "usage",
              next: expect.stringContaining('peer ask <task> "<question>"'),
            });
          ana.fixture.broker.sessions.get("claude:one")!.task = "task-main";
          await expect(
            ana.fixture.broker.runCli("ask", ["project", QUESTION], AS_ONE),
          ).rejects.toMatchObject({ outcome: "usage" });
          ana.fixture.broker.views.set("acme", { sessions: [], overlaps: [], at: "2026-10-09" });
          ana.fixture.broker.syncNow = async () => {};
          await expect(
            ana.fixture.broker.runCli("ask", ["KRK-2", QUESTION], AS_ONE),
          ).rejects.toMatchObject({
            outcome: "refused",
            next: expect.stringContaining("peer context KRK-2"),
          });
          expect(ana.claims()).toEqual([]);
          expect(scene.notes).toEqual([]);
        });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("rolls back the claim when an older Hub opens no conversation", () =>
    Effect.gen(function* () {
      const { scene, host } = virOnSpeakers();
      const ana = yield* anaWithAsk({
        ...host,
        report: async () => ({ ...(await host.view!("acme")), overlaps: [] }),
      });
      yield* Effect.promise(() =>
        expect(ana.fixture.broker.runCli("ask", ["KRK-2", QUESTION], AS_ONE)).rejects.toMatchObject(
          { outcome: "refused", reason: expect.stringContaining("opened no conversation") },
        ),
      );
      assert.deepStrictEqual(ana.claims(), []);
      assert.deepStrictEqual(scene.notes, []);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
  it.effect("keeps a partially sent question uncertain and preserves its task claim", () =>
    Effect.gen(function* () {
      const { scene, host } = virOnSpeakers();
      const twice = (view: HubCoordView): HubCoordView => ({
        ...view,
        overlaps: view.overlaps.flatMap((overlap) => [overlap, { ...overlap, id: "second" }]),
      });
      let writes = 0;
      const ana = yield* anaWithAsk({
        ...host,
        view: async (workspace) => twice(await host.view!(workspace)),
        report: async (workspace, sessions) => twice(await host.report!(workspace, sessions)),
        note: async (...args) => {
          if (++writes === 2)
            throw new PeerHubError({ detail: "The second conversation changed", refused: true });
          return host.note!(...args);
        },
      });
      yield* Effect.promise(() =>
        expect(ana.fixture.broker.runCli("ask", ["KRK-2", QUESTION], AS_ONE)).rejects.toMatchObject(
          { outcome: "uncertain", next: expect.stringContaining("peer status") },
        ),
      );
      assert.strictEqual(scene.notes.length, 1);
      assert.include(ana.claims(), "task:task-2");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
  it.effect("rolls back a new task claim when the Hub explicitly refuses the question", () =>
    Effect.gen(function* () {
      const { scene, host } = virOnSpeakers();
      const ana = yield* anaWithAsk({
        ...host,
        note: async () => {
          throw new PeerHubError({ detail: "The Hub refused the question", refused: true });
        },
      });
      yield* Effect.promise(() =>
        expect(ana.fixture.broker.runCli("ask", ["KRK-2", QUESTION], AS_ONE)).rejects.toMatchObject(
          { outcome: "refused" },
        ),
      );
      assert.deepStrictEqual(scene.notes, []);
      assert.deepStrictEqual(ana.claims(), []);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
  it.effect("asks the agents at work on a task in the conversation the hub opens", () =>
    Effect.gen(function* () {
      const { scene, host } = virOnSpeakers();
      const ana = yield* anaWithAsk(host);
      assert.strictEqual(
        yield* ana.run("ask", ["KRK-2", QUESTION]),
        `Asked the agents on KRK-2 · Speakers: Vir's agent (on another computer). They hear it at their next step, or wake up if idle, and their answer reaches you as Peer news (peer status shows the conversation). Once settled: peer resolve "<agreement>".`,
      );
      assert.deepStrictEqual(scene.notes, [{ session: "claude:one", text: QUESTION }]);
      assert.include(ana.claims(), "task:task-2");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("drops the question once its conversation settles", () =>
    Effect.gen(function* () {
      const { scene, host } = virOnSpeakers();
      const ana = yield* anaWithAsk(host);
      yield* ana.run("ask", ["KRK-2", QUESTION]);
      scene.resolved = true;
      yield* ana.sync;
      yield* settled;
      assert.notInclude(ana.claims(), "task:task-2");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("peer ask turned off", () => {
  it.effect("is refused in one line, writes and claims nothing, and leaves help", () =>
    Effect.gen(function* () {
      const { scene, host } = virOnSpeakers();
      const ana = yield* anaWithAsk(host);
      assert.include(yield* ana.run("help"), 'peer ask <task> "<question>"');

      yield* ana.plugins.setPlugin({ id: "ask", enabled: false });
      yield* Effect.promise(() =>
        expect(
          ana.fixture.broker["runCli"]("ask", ["KRK-2", QUESTION], AS_ONE),
        ).rejects.toMatchObject({
          status: 409,
          message: "ask is turned off on this environment.",
        }),
      );
      assert.deepStrictEqual(scene.notes, []);
      assert.deepStrictEqual(ana.claims(), []);
      assert.notInclude(yield* ana.run("help"), "peer ask");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("leaves an open conversation an ordinary overlap, and drops it once on again", () =>
    Effect.gen(function* () {
      const { scene, host } = virOnSpeakers();
      const ana = yield* anaWithAsk(host);
      yield* ana.run("ask", ["KRK-2", QUESTION]);
      yield* ana.plugins.setPlugin({ id: "ask", enabled: false });

      // Vir's agent answers there: Ana's agent hears it at its next step, as on any overlap.
      scene.notes.push({ session: "claude:vir", text: "In speakers.json, keyed by talk." });
      yield* ana.sync;
      const next = yield* Effect.promise(() =>
        ana.fixture.broker["hook"](
          {
            session_id: "one",
            cwd: ana.fixture.root,
            hook_event_name: "UserPromptSubmit",
            prompt: "Go on.",
          },
          {},
        ),
      );
      const told = (next?.hookSpecificOutput as { readonly additionalContext?: string } | undefined)
        ?.additionalContext;
      assert.include(told ?? "", "In speakers.json, keyed by talk.");

      // Settled while ask is off, the conversation keeps its claim: nothing drops it for ask.
      scene.resolved = true;
      yield* ana.sync;
      yield* settled;
      assert.include(ana.claims(), "task:task-2");

      // On again, ask drops the settled question at the next change.
      yield* ana.plugins.setPlugin({ id: "ask", enabled: true });
      yield* settled;
      yield* ana.sync;
      yield* settled;
      assert.notInclude(ana.claims(), "task:task-2");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
