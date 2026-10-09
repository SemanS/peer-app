import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { PeerHubClient } from "../../core/hub/PeerHubClient.ts";
import { coreLayer, seedState, signedInSeed, standInHub } from "../../core/testkit.ts";
import { hubDigest } from "./hubDigest.ts";
it.effect(
  "owns the authenticated digest query and decodes old, expired and unreachable Hub responses",
  () =>
    Effect.gen(function* () {
      let code = 200;
      const sample = {
        project: "app/a",
        since: "2026-10-09T00:00:00Z",
        until: "2026-10-09T08:00:00Z",
        coverage: { complete: true },
        sections: [],
      };
      const hub = yield* standInHub({
        current: () => [
          code,
          code === 401 ? { error: { code: "unauthenticated", message: "Ended" } } : sample,
        ],
      });
      const core = yield* Layer.build(
        coreLayer(yield* seedState(signedInSeed(hub.url)), { session: "phs_test" }),
      );
      const get = hubDigest(yield* PeerHubClient.pipe(Effect.provide(core)));
      const input = {
        workspace: "acme",
        project: "app/a",
        since: "2026-10-09T01:00:00+02:00",
        limit: 4,
      };
      expect(yield* get(input)).toEqual(sample);
      expect(hub.calls.at(-1)?.authorization).toBe("Bearer phs_test");
      expect(hub.calls.at(-1)?.url).toBe(
        "/v1/workspaces/acme/projects/app%2Fa/digest?since=2026-10-09T01%3A00%3A00%2B02%3A00&limit=4",
      );
      for (code of [404, 405]) expect(yield* get(input)).toBeNull();
      code = 401;
      expect(yield* get(input).pipe(Effect.flip)).toMatchObject({
        _tag: "PeerHubError",
        code: "unauthenticated",
      });
      yield* Effect.promise(() => {
        hub.server.closeAllConnections();
        return new Promise<void>((resolve) => hub.server.close(() => resolve()));
      });
      expect(yield* get(input).pipe(Effect.flip)).toMatchObject({ _tag: "PeerHubError" });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
