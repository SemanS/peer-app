import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { PeerHubClient } from "../../core/hub/PeerHubClient.ts";
import { coreLayer, seedState, signedInSeed, standInHub } from "../../core/testkit.ts";
import { makeHubClient } from "./hubClient.ts";
it.effect(
  "owns all resource routes, decodes new bodies and treats old 404 and 405 as unsupported",
  () =>
    Effect.gen(function* () {
      let code = 200;
      const resource = {
        project: "app",
        kind: "pattern",
        name: "migrations/**",
        holder: { session: "a", email: "ana", environment: "laptop" },
        expiresAt: "2026-10-09T12:30:00Z",
      };
      const hub = yield* standInHub({
        current: (url) => [
          code,
          url.endsWith("/claim")
            ? { verdict: "clear", resource, at: "2026-10-09T12:00:00Z" }
            : url.endsWith("/release")
              ? { released: true, resource, at: "2026-10-09T12:00:00Z" }
              : {
                  held: [resource],
                  patterns: { app: [{ pattern: "migrations/**", policy: "exclusive" }] },
                  at: "2026-10-09T12:00:00Z",
                },
        ],
      });
      const core = yield* Layer.build(
        coreLayer(yield* seedState(signedInSeed(hub.url)), { session: "phs_test" }),
      );
      const client = makeHubClient(yield* PeerHubClient.pipe(Effect.provide(core)));
      expect((yield* client.list("acme"))?.held[0]?.kind).toBe("pattern");
      expect(
        (yield* client.claim("acme", "app/a", {
          environment: "laptop",
          session: "a",
          name: "deploy",
          ttlSeconds: 1800,
          op: "claim",
        }))?.verdict,
      ).toBe("clear");
      expect(hub.calls.at(-1)?.url).toContain("app%2Fa/claim");
      expect(
        (yield* client.release("acme", "app", { target: "migrations/**", op: "release" }))
          ?.released,
      ).toBe(true);
      for (code of [404, 405]) {
        expect(yield* client.list("acme")).toBeNull();
        expect(
          yield* client.claim("acme", "app", {
            environment: "laptop",
            session: "a",
            name: "deploy",
            ttlSeconds: 1800,
            op: "claim",
          }),
        ).toBeNull();
        expect(
          yield* client.release("acme", "app", { target: "resource:deploy", op: "release" }),
        ).toBeNull();
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
