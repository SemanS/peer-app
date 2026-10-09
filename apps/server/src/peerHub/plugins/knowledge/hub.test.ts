import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import { coreLayer, seedState, signedInSeed, standInHub } from "../../core/testkit.ts";
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
