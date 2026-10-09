import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import type { PeerHubError } from "@t3tools/contracts";
import {
  coreLayer,
  seedState,
  signedInSeed,
  standInHub,
  type HubAnswer,
} from "../../core/testkit.ts";
import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import { requestsHub } from "./hub.ts";
const row = {
  id: "one",
  project: "app",
  task: "task",
  sender: "ana@acme.test",
  recipient: "bob@acme.test",
  title: "Pull",
  prompt: "Flows",
  status: "dismissed" as const,
  closedBy: "sender",
  expiresAt: "2026-10-22",
  createdAt: "now",
  updatedAt: "now",
};
const program = (
  answer: HubAnswer,
  check: (
    api: ReturnType<typeof requestsHub>,
    hub: Effect.Success<ReturnType<typeof standInHub>>,
  ) => Effect.Effect<void, PeerHubError>,
) =>
  Effect.gen(function* () {
    const hub = yield* standInHub({ current: answer });
    const core = yield* Layer.build(
      coreLayer(yield* seedState(signedInSeed(hub.url)), { session: "person" }),
    );
    yield* check(requestsHub(yield* PeerHubClient.PeerHubClient.pipe(Effect.provide(core))), hub);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));
describe("requests endpoints", () => {
  it.effect("withdraws on DELETE and decodes compatible closures", () =>
    program(
      () => [200, row],
      (api, hub) =>
        Effect.gen(function* () {
          assert.deepStrictEqual(
            yield* api.withdraw({ workspace: "acme", projectId: "app", requestId: "one" }),
            row,
          );
          assert.deepStrictEqual(
            hub.calls.map((c) => [c.method, c.url]),
            [["DELETE", "/v1/workspaces/acme/projects/app/requests/one"]],
          );
        }),
    ),
  );
  it.effect.each([404, 405])("lists unsupported %s as empty", (status) =>
    program(
      () => [status, { error: { code: "not_found", message: "no such route" } }],
      (api) =>
        Effect.gen(function* () {
          assert.deepStrictEqual(yield* api.inbox("acme"), []);
        }),
    ),
  );
  it.effect("keeps a meaningful known 404 and refuses an unavailable withdrawal route", () =>
    program(
      () => [404, { error: { code: "not_found", message: "Unknown request." } }],
      (api) =>
        Effect.gen(function* () {
          const result = yield* api
            .withdraw({ workspace: "acme", projectId: "app", requestId: "one" })
            .pipe(Effect.result);
          assert.isTrue(Result.isFailure(result));
          if (Result.isFailure(result)) assert.include(result.failure.detail, "Unknown request");
        }),
    ),
  );
  it.effect("refuses withdrawal on an older Hub", () =>
    program(
      () => [405, {}],
      (api) =>
        Effect.gen(function* () {
          const result = yield* api
            .withdraw({ workspace: "acme", projectId: "app", requestId: "one" })
            .pipe(Effect.result);
          assert.isTrue(Result.isFailure(result));
          if (Result.isFailure(result)) {
            assert.isTrue(result.failure.refused);
            assert.include(result.failure.detail, "cannot withdraw");
          }
        }),
    ),
  );
  it.effect("never turns a failed read into an empty inbox", () =>
    program(
      () => [503, { error: { code: "unavailable", message: "Try later" } }],
      (api) =>
        Effect.gen(function* () {
          assert.isTrue(Result.isFailure(yield* api.inbox("acme").pipe(Effect.result)));
        }),
    ),
  );
});
