import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  coreLayer,
  seedState,
  signedInSeed,
  standInHub,
  type HubAnswer,
} from "../../core/testkit.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import { Requests, layer } from "./Requests.ts";
const row = {
  id: "one",
  project: "app",
  task: "task",
  sender: "ana@acme.test",
  recipient: "bob@acme.test",
  title: "Pull",
  prompt: "Flows",
  status: "pending" as const,
  createdAt: "now",
  updatedAt: "now",
};
it.effect("distinguishes unread from empty, keeps the last successful slice and forgets it", () =>
  Effect.gen(function* () {
    const answer: { current: HubAnswer } = { current: () => [200, { requests: [row] }] };
    const hub = yield* standInHub(answer);
    const core = yield* Layer.build(
      coreLayer(yield* seedState(signedInSeed(hub.url)), { session: "person" }),
    );
    const status = yield* PeerStatus.PeerStatus.pipe(Effect.provide(core));
    yield* status.coordinationFrom(() =>
      Effect.succeed({
        enabled: false,
        policy: "coordinate",
        claudeHooks: false,
        logPath: "/tmp/test",
        sessions: [],
        overlaps: [],
        findings: [],
        contexts: [],
        candidates: [],
      }),
    );
    const built = yield* Layer.build(layer).pipe(Effect.provide(core));
    const requests = yield* Requests.pipe(Effect.provide(built));
    assert.isUndefined(yield* requests.inbox);
    yield* requests.refresh("acme");
    assert.deepStrictEqual(yield* requests.inbox, [{ workspace: "acme", request: row }]);
    answer.current = () => [503, { error: { code: "unavailable", message: "Try later" } }];
    yield* requests.refresh("acme");
    assert.deepStrictEqual(yield* requests.inbox, [{ workspace: "acme", request: row }]);
    answer.current = () => [404, {}];
    yield* requests.refresh("acme");
    assert.deepStrictEqual(yield* requests.inbox, []);
    yield* requests.forget;
    assert.isUndefined(yield* requests.inbox);
    assert.isTrue(
      hub.calls.every((call) => call.method === "GET" && call.url?.endsWith("/requests")),
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
