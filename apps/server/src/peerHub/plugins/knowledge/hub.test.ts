import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { PeerHubError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import {
  coreLayer,
  seedState,
  signedInSeed,
  standInHub,
  type HubAnswer,
} from "../../core/testkit.ts";
import { knowledgeHub } from "./client/hub.ts";
const candidate = {
  id: "c",
  project: "app",
  text: "Retry",
  sources: [],
  finders: 1,
  firstAt: "2026-10-09T00:00:00Z",
  lastAt: "2026-10-09T00:00:00Z",
};
describe("knowledge review lane HTTP", () => {
  it.effect(
    "keeps supported list items when a newer Hub adds a state and decodes pending review answers",
    () =>
      Effect.gen(function* () {
        const statuses = ["proposed", "dismissed", "promoted", "kept_pending_review", "future"];
        let listing = true;
        const hub = yield* standInHub({
          current: (path) =>
            !listing || path.endsWith("/c")
              ? [200, { ...candidate, status: "kept_pending_review" }]
              : [200, statuses.map((status, id) => ({ ...candidate, id: String(id), status }))],
        });
        const core = yield* Layer.build(
          coreLayer(yield* seedState(signedInSeed(hub.url)), { session: "phs_test" }),
        );
        const skipped: number[] = [];
        const api = knowledgeHub(
          yield* PeerHubClient.PeerHubClient.pipe(Effect.provide(core)),
          (count) =>
            Effect.sync(() => {
              skipped.push(count);
            }),
        );
        const rows = yield* api.candidates("acme", "app");
        expect(rows.map((r) => r.status)).toEqual(statuses.slice(0, 4));
        expect(skipped).toEqual([1]);
        listing = false;
        expect((yield* api.decide("acme", "app", "c", "promoted")).status).toBe(
          "kept_pending_review",
        );
        expect(
          (yield* api.propose("acme", "app", { text: "Retry", origin: "task:one" })).status,
        ).toBe("kept_pending_review");
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

/** What listing app's candidates comes to against a Hub that answers every path with `answer`. */
const listing = (answer: HubAnswer) =>
  Effect.gen(function* () {
    const hub = yield* standInHub({ current: answer });
    const core = yield* Layer.build(
      coreLayer(yield* seedState(signedInSeed(hub.url)), { session: "phs_test" }),
    );
    const api = knowledgeHub(yield* PeerHubClient.PeerHubClient.pipe(Effect.provide(core)));
    return { hub, result: yield* api.candidates("acme", "app").pipe(Effect.result) };
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

const failed = (result: Result.Result<unknown, PeerHubError>) => {
  expect(Result.isFailure(result)).toBe(true);
  if (!Result.isFailure(result)) throw new Error("the listing did not fail");
  return result.failure;
};

describe("a project's candidates when the Hub cannot answer", () => {
  it.effect(
    "keeps a project with no candidates an empty list, which only a Hub that answered says",
    () =>
      Effect.gen(function* () {
        const { hub, result } = yield* listing(() => [200, []]);
        expect(Result.isSuccess(result) ? result.success : null).toEqual([]);
        expect(hub.calls.map((call) => call.url)).toEqual(["/v1/workspaces/acme/candidates/app"]);
      }),
  );

  it.effect("fails with unsupported, never an empty list, on a Hub without the route", () =>
    Effect.gen(function* () {
      // A current Hub with knowledge turned off says "no such route"; an older one answers a bare 404.
      for (const answer of [
        [404, { error: { code: "not_found", message: "no such route" } }],
        [404, undefined],
      ] as const) {
        const { hub, result } = yield* listing(() => answer);
        const error = failed(result);
        expect(error).toBeInstanceOf(PeerHubError);
        expect([error.kind, error.status, error.refused]).toEqual(["unsupported", 404, true]);
        expect(error.request).toBe("GET /v1/workspaces/acme/candidates/app");
        expect(error.hubUrl).toBe(hub.url);
        expect(error.detail).toBe("This Hub has no knowledge to keep yet.");
      }
    }),
  );

  it.effect(
    "leaves a project the Hub does not know, and every other refusal, as the Hub said it",
    () =>
      Effect.gen(function* () {
        const unknown = failed(
          (yield* listing(() => [
            404,
            { error: { code: "not_found", message: "no workspace `app`" } },
          ])).result,
        );
        expect([unknown.kind, unknown.status, unknown.code, unknown.detail]).toEqual([
          "refused",
          404,
          "not_found",
          "no workspace `app`",
        ]);

        const down = failed(
          (yield* listing(() => [
            502,
            { error: { code: "knowledge_down", message: "knowledge store unavailable" } },
          ])).result,
        );
        expect([down.kind, down.status, down.detail]).toEqual([
          "refused",
          502,
          "knowledge store unavailable",
        ]);

        const ended = failed(
          (yield* listing(() => [
            401,
            { error: { code: "unauthenticated", message: "the session ended; sign in again" } },
          ])).result,
        );
        expect([ended.kind, ended.status]).toEqual(["signedOut", 401]);
      }),
  );

  it.effect("fails as signed out without asking the Hub when there is no session", () =>
    Effect.gen(function* () {
      const hub = yield* standInHub({ current: () => [200, []] });
      const core = yield* Layer.build(coreLayer(yield* seedState(signedInSeed(hub.url))));
      const api = knowledgeHub(yield* PeerHubClient.PeerHubClient.pipe(Effect.provide(core)));
      const error = failed(yield* api.candidates("acme", "app").pipe(Effect.result));
      expect([error.kind, error.detail]).toEqual(["signedOut", "Sign in first."]);
      expect(hub.calls).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
