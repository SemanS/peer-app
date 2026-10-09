import * as Deferred from "effect/Deferred";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import { PeerHubError } from "@t3tools/contracts";
import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
// @effect-diagnostics preferSchemaOverJson:off - test-only Hub request bodies and seeded state JSON.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { PeerTask, PeerPluginId } from "@t3tools/contracts";
import type { PeerSessionView } from "../../core/plugin.ts";
import * as PeerWork from "../../core/work/PeerWork.ts";
import * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import {
  type HubCall,
  coreLayer,
  paymentsSeed,
  seedState,
  standInHub,
} from "../../core/testkit.ts";
import { Dependencies, layer } from "./service.ts";
import { dependsCli } from "./cli.ts";
const task = (id: string): PeerTask => ({
  id,
  key: id.toUpperCase(),
  title: id,
  status: "open",
  createdAt: "",
  updatedAt: "",
  createdBy: "ana",
});
const session = (agent: "claude" | "codex"): PeerSessionView => {
  const memory = new Map<PeerPluginId, unknown>();
  return {
    id: `${agent}:one`,
    agent,
    adapter: "hooks",
    runtimeGeneration: "one",
    workspace: "acme",
    project: "pay",
    root: "/tmp",
    cwd: "/tmp",
    repositoryId: undefined,
    task: "b",
    thread: undefined,
    pane: undefined,
    status: "working",
    keeps: false,
    files: [],
    claims: [],
    local: <S>(id: PeerPluginId, init: () => S): S => {
      if (!memory.has(id)) memory.set(id, init());
      return memory.get(id) as S;
    },
  };
};
const coordination = {
  enabled: false,
  policy: "coordinate" as const,
  claudeHooks: false,
  logPath: "",
  sessions: [],
  overlaps: [],
  findings: [],
  contexts: [],
  candidates: [],
};
describe("dependencies service and CLI", () => {
  it.effect(
    "cold cache, failure retention, remove flag, no self-echo and both agent harnesses",
    () =>
      Effect.gen(function* () {
        let on = ["a"],
          broken = false;
        let calls: ReadonlyArray<HubCall> = [];
        const hub = yield* standInHub({
          current: () => {
            const request = calls.at(-1)!;
            if (broken) return [503, { error: { code: "unavailable", message: "down" } }];
            if (request.method === "PATCH") {
              const body = JSON.parse(request.body) as { add: string[]; remove: string[] };
              on = on.filter((id) => !body.remove.includes(id));
              for (const id of body.add) if (!on.includes(id)) on.push(id);
              return [200, { task: "b", changed: true, dependsOn: on }];
            }
            return [200, { projects: on.length ? { pay: { b: on } } : {} }];
          },
        });
        calls = hub.calls;
        const seed = JSON.parse(paymentsSeed(hub.url));
        seed.coordination = { enabled: true, policy: "coordinate" };
        const core = yield* Layer.build(
          coreLayer(yield* seedState(JSON.stringify(seed)), { session: "s", plugins: [] }),
        );
        const originals = yield* Effect.gen(function* () {
          yield* (yield* PeerStatus.PeerStatus).coordinationFrom(() =>
            Effect.succeed(coordination),
          );
          return { work: yield* PeerWork.PeerWork, agents: yield* PeerAgents.PeerAgents };
        }).pipe(Effect.provide(core));
        const work = {
          ...originals.work,
          tasks: () => Effect.succeed([task("a"), task("b")]),
          threads: () => Effect.succeed([]),
        };
        const own = yield* Layer.build(layer).pipe(
          Effect.provide(Context.add(core, PeerWork.PeerWork, work)),
        );
        const service = Context.get(own, Dependencies);
        const claude = session("claude"),
          codex = session("codex");
        assert.isNull(yield* service.hook(claude, true));
        yield* service.refresh();
        const start = yield* service.hook(claude, false);
        assert.include(start!, "you depend on A");
        assert.strictEqual(yield* service.hook(codex, true), start);
        assert.isNull(yield* service.hook(claude, false));
        broken = true;
        yield* service.refresh();
        assert.isTrue((yield* service.snapshot)[0]?.available);
        broken = false;
        const cli = dependsCli(service, work, originals.agents);
        const input = {
          session: claude,
          args: ["--remove", "A"],
          plain: [],
          text: "",
          flag: () => undefined,
          cwd: undefined,
        };
        assert.strictEqual(yield* cli(input), "B no longer depends on A.");
        assert.isNull(yield* service.hook(claude, false));
        assert.strictEqual(yield* cli(input), "B did not depend on A.");
        assert.include(yield* cli({ ...input, args: [], plain: [] }), "Depended on by:");
        yield* service.cleanup([]);
        assert.deepStrictEqual(yield* service.snapshot, []);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

it.effect(
  "coalesces pings, gates work without edges, probes legacy Hubs and publishes differences only",
  () =>
    Effect.gen(function* () {
      let mode: "empty" | "edges" | "legacy" | "broken" = "empty",
        reads = 0,
        publishes = 0;
      let milestone = yield* Deferred.make<void>();
      const request: PeerHubClient.PeerHubClient["Service"]["request"] = (schema, input) =>
        Effect.gen(function* () {
          reads++;
          if (mode === "broken") return yield* new PeerHubError({ detail: "offline" });
          if (mode === "legacy") return input.unsupported!.value;
          return yield* Schema.decodeUnknownEffect(schema)({
            projects: mode === "edges" ? { pay: { b: ["a"] } } : {},
          }).pipe(Effect.mapError(() => new PeerHubError({ detail: "bad fixture" })));
        });
      const core = yield* Layer.build(
        coreLayer(yield* seedState(paymentsSeed("https://hub.test")), {
          session: "s",
          plugins: [],
        }),
      );
      const original = Context.get(core, PeerHubClient.PeerHubClient),
        originalStatus = Context.get(core, PeerStatus.PeerStatus);
      const testing = Context.add(
        Context.add(core, PeerHubClient.PeerHubClient, { ...original, request }),
        PeerStatus.PeerStatus,
        {
          ...originalStatus,
          publish: Effect.suspend(() =>
            Effect.sync(() => {
              publishes++;
            }).pipe(Effect.andThen(Deferred.succeed(milestone, undefined)), Effect.as({} as never)),
          ),
        },
      );
      const service = Context.get(
        yield* Layer.build(layer).pipe(Effect.provide(testing)),
        Dependencies,
      );
      yield* service.refresh();
      assert.strictEqual(reads, 1);
      assert.strictEqual(publishes, 1);
      yield* service.refresh();
      assert.strictEqual(reads, 2);
      assert.strictEqual(publishes, 1);
      yield* service.run.pipe(Effect.forkChild);
      yield* service.ping("acme", "work");
      yield* TestClock.adjust("300 millis");
      assert.strictEqual(reads, 2);
      mode = "edges";
      milestone = yield* Deferred.make<void>();
      yield* service.ping("acme", "dependencies");
      yield* service.ping("acme", "dependencies");
      yield* TestClock.adjust("300 millis");
      yield* Deferred.await(milestone);
      assert.strictEqual(reads, 3);
      assert.strictEqual(publishes, 2);
      mode = "empty";
      milestone = yield* Deferred.make<void>();
      yield* service.ping("acme", "work");
      yield* TestClock.adjust("300 millis");
      yield* Deferred.await(milestone);
      assert.strictEqual(reads, 4);
      mode = "broken";
      yield* service.refresh();
      assert.isTrue((yield* service.snapshot)[0]?.available);
      assert.strictEqual(publishes, 3);
      mode = "legacy";
      yield* service.refresh();
      assert.isFalse((yield* service.snapshot)[0]?.available);
      const before = reads;
      yield* service.refresh();
      assert.strictEqual(reads, before);
      yield* TestClock.adjust("10 minutes");
      yield* service.refresh();
      assert.strictEqual(reads, before + 1);
      yield* service.cleanup([]);
      assert.deepStrictEqual(yield* service.snapshot, []);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
