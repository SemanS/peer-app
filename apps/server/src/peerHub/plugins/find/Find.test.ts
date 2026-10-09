// @effect-diagnostics nodeBuiltinImport:off - the broker's shim in a temporary checkout.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterEach, assert, beforeEach, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { vi } from "vite-plus/test";

import { brokerFixture, pluginsOf } from "../../core/broker/testkit.ts";
import * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import * as PeerIndex from "../../core/index/PeerIndex.ts";
import { bindPlugin, type PeerIndexEntry } from "../../core/plugin.ts";
import * as PeerPlugins from "../../core/plugins/PeerPlugins.ts";
import { coreLayer, seedState } from "../../core/testkit.ts";
import { projectAcceptsPersonal } from "../../hubPolicy.ts";
import { runModel } from "./findModel.ts";
import { FindPlugin } from "./index.ts";

vi.mock("./findModel.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./findModel.ts")>()),
  runModel: vi.fn(),
}));
vi.mock("../../hubPolicy.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../hubPolicy.ts")>()),
  projectAcceptsPersonal: vi.fn(() => true),
}));

// `peer find` asks a model; these tests stand one in (`runModel`).
beforeEach(() => {
  vi.stubEnv("PEER_RELATED_MODEL", "on");
  vi.mocked(projectAcceptsPersonal).mockReturnValue(true);
});

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

/** The one `.ai` decision in acme's app checkout. */
const PRICES: PeerIndexEntry = {
  id: "prices",
  kind: "decision",
  title: "Keep prices in cents",
  status: undefined,
  date: undefined,
  summary: "",
  tags: [],
  paths: [],
  file: ".ai/decisions/prices.md",
  body: "Prices are integers.",
};

/** What fills the index's entries (knowledge does, in the build): the decision above. */
const IndexSource = bindPlugin({
  id: "knowledge",
  title: "Knowledge",
  summary: "A stand-in index source.",
  defaultEnabled: true,
  layer: Layer.empty,
  make: Effect.succeed({
    indexSource: { entries: () => Effect.succeed([PRICES]), section: () => null },
  }),
});

/**
 * Ana's Peer with the find plugin, and a broker in acme's app checkout (one `.ai` decision there)
 * running its commands, as coordination hands the broker to core.
 */
const anaWithFind = Effect.gen(function* () {
  const core = yield* Layer.build(
    coreLayer(yield* seedState(), { plugins: [IndexSource, FindPlugin] }),
  );
  return yield* Effect.gen(function* () {
    yield* PeerPlugins.startPlugins;
    const plugins = yield* PeerPlugins.PeerPlugins;
    const fixture = yield* Effect.acquireRelease(
      Effect.promise(() => brokerFixture(() => pluginsOf(plugins))),
      (made) => Effect.promise(() => made.dispose()),
    );
    yield* (yield* PeerAgents.PeerAgents).attach(fixture.broker);
    yield* (yield* PeerIndex.PeerIndex).attach(fixture.broker);
    return { fixture, plugins };
  }).pipe(Effect.provide(core));
});

describe("peer find reservations", () => {
  it.effect(
    "classifies missing text, model-off, rejected capacity and model failure without touching claims or notes",
    () =>
      Effect.gen(function* () {
        const { fixture } = yield* anaWithFind;
        yield* Effect.promise(async () => {
          await fixture.register("one");
          const session = fixture.broker.sessions.get("claude:one")!;
          session.claims = ["pay.ts"];
          session.pending.push("unheard note");
          await expect(
            fixture.broker.runCli("find", [], { "x-peer-session": "one" }),
          ).rejects.toMatchObject({ outcome: "usage", next: expect.stringContaining("peer find") });
          vi.stubEnv("PEER_RELATED_MODEL", "off");
          await expect(fixture.find("one")).rejects.toMatchObject({
            outcome: "refused",
            reason: expect.stringContaining("turned off"),
          });
          vi.stubEnv("PEER_RELATED_MODEL", "on");
          vi.mocked(projectAcceptsPersonal).mockReturnValue(false);
          await expect(fixture.find("one")).rejects.toMatchObject({
            outcome: "refused",
            next: expect.stringContaining("peer index"),
          });
          expect(runModel).not.toHaveBeenCalled();
          vi.mocked(projectAcceptsPersonal).mockReturnValue(true);
          vi.mocked(runModel).mockRejectedValue(new Error("provider failed"));
          await expect(fixture.find("one")).rejects.toMatchObject({
            outcome: "refused",
            reason: expect.stringContaining("model could not answer"),
          });
          expect(session.claims).toEqual(["pay.ts"]);
          expect(session.pending).toEqual(["unheard note"]);
          expect(session.memory.acknowledged.size).toBe(0);
        });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
  it.effect("refuses a concurrent second request from the same agent after synchronization", () =>
    Effect.gen(function* () {
      const { fixture } = yield* anaWithFind;
      vi.mocked(runModel).mockResolvedValue('{"related":[]}');
      yield* Effect.promise(async () => {
        await fixture.register("one");
        const answers = await Promise.allSettled([fixture.find("one"), fixture.find("one")]);
        expect(runModel).toHaveBeenCalledTimes(1);
        expect(
          answers.filter(
            (answer) => answer.status === "rejected" && answer.reason.message.includes("wait"),
          ),
        ).toHaveLength(1);
      });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("runs at most two models when three agents request a find together", () =>
    Effect.gen(function* () {
      const { fixture } = yield* anaWithFind;
      const model = Promise.withResolvers<string>();
      const thirdModel = Promise.withResolvers<string>();
      vi.mocked(runModel).mockImplementation(() => {
        if (vi.mocked(runModel).mock.calls.length === 3) thirdModel.resolve("third model started");
        return model.promise;
      });
      yield* Effect.promise(async () => {
        let requests: Promise<string>[] = [];
        try {
          await fixture.register("one");
          await fixture.register("two");
          await fixture.register("three");
          requests = [fixture.find("one"), fixture.find("two"), fixture.find("three")];
          const refused = await Promise.race([
            requests[2]!.catch((error) => error.message),
            thirdModel.promise,
          ]);
          expect(refused).toContain("other agents");
          expect(runModel).toHaveBeenCalledTimes(2);
        } finally {
          model.resolve('{"related":[]}');
          await Promise.allSettled(requests);
        }
      });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("peer find turned off", () => {
  it.effect("is refused in one line, asks no model and leaves help; on again, it runs", () =>
    Effect.gen(function* () {
      const { fixture, plugins } = yield* anaWithFind;
      vi.mocked(runModel).mockResolvedValue('{"related":[]}');
      yield* Effect.promise(() => fixture.register("one"));
      const help = () => Effect.promise(() => fixture.broker["runCli"]("help", [], {}));
      const line =
        '  peer find "<what you will do>"  a model looks for what bears on it, when you cannot tell';
      assert.strictEqual(
        (yield* help()).split("\n").find((line) => line.startsWith("  peer find ")),
        line,
      );

      yield* plugins.setPlugin({ id: "find", enabled: false });
      yield* Effect.promise(() =>
        expect(fixture.find("one")).rejects.toMatchObject({
          status: 409,
          message: "find is turned off on this environment.",
        }),
      );
      assert.notInclude(yield* help(), "peer find");
      expect(runModel).not.toHaveBeenCalled();

      yield* plugins.setPlugin({ id: "find", enabled: true });
      assert.include(yield* Effect.promise(() => fixture.find("one")), "found nothing");
      expect(runModel).toHaveBeenCalledOnce();
      assert.strictEqual(
        (yield* help()).split("\n").find((line) => line.startsWith("  peer find ")),
        line,
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("leaves the shim waiting 150 s for find, whether or not it is on", () =>
    Effect.gen(function* () {
      const { fixture, plugins } = yield* anaWithFind;
      yield* plugins.setPlugin({ id: "find", enabled: false });
      yield* Effect.promise(() => fixture.broker.start());
      const shim = yield* Effect.promise(() =>
        NodeFSP.readFile(NodePath.join(fixture.root, "scripts", "bin", "peer"), "utf8"),
      );
      assert.include(shim, "max=15\n[ \"$cmd\" = 'find' ] && max=150\n");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
