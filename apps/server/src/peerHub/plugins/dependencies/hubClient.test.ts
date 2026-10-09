import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import { coreLayer, paymentsSeed, seedState, standInHub } from "../../core/testkit.ts";
import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import { hubClient } from "./hubClient.ts";
describe("dependencies Hub mapping", () => {
  it.effect("only treats missing routes as unsupported and maps actionable cycle paths", () =>
    Effect.gen(function* () {
      let answer: [number, unknown] = [200, { projects: { pay: { b: ["a"] } } }];
      const hub = yield* standInHub({ current: () => answer });
      const core = yield* Layer.build(
        coreLayer(yield* seedState(paymentsSeed(hub.url)), { session: "s", plugins: [] }),
      );
      const client = hubClient(yield* PeerHubClient.PeerHubClient.pipe(Effect.provide(core)));
      assert.isTrue((yield* client.read("acme")).available);
      answer = [404, { error: { code: "not_found", message: "no such route" } }];
      assert.isFalse((yield* client.read("acme")).available);
      answer = [405, {}];
      assert.isFalse((yield* client.read("acme")).available);
      answer = [404, { error: { code: "not_found", message: "no such project" } }];
      assert.isTrue(Result.isFailure(yield* client.read("acme").pipe(Effect.result)));
      answer = [
        409,
        {
          error: { code: "dependency_cycle", message: "cycle", details: { path: ["a", "b", "a"] } },
        },
      ];
      assert.deepStrictEqual(
        yield* client.change({ workspace: "acme", projectId: "pay", taskId: "a", add: ["b"] }),
        { kind: "cycle", path: ["a", "b", "a"] },
      );
      answer = [200, { task: "a", changed: false, dependsOn: ["b"] }];
      assert.deepStrictEqual(
        yield* client.change({ workspace: "acme", projectId: "pay", taskId: "a", add: ["b"] }),
        { kind: "changed", changed: false, dependsOn: ["b"] },
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
