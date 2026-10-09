import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Layer from "effect/Layer";
import { coreLayer, seedState, signedInSeed, standInHub } from "../testkit.ts";
import * as PeerStatus from "../status/PeerStatus.ts";
import * as PeerWorkspaces from "./PeerWorkspaces.ts";

describe("workspace identity through core", () => {
  it.effect(
    "sign-in on an ambiguous older Hub never joins and confirmed offers forward consent",
    () =>
      Effect.gen(function* () {
        const hub = yield* standInHub({
          current: (path) =>
            path === "/v1/auth/email/start"
              ? [200, { email: "ana@acme.test", sent: true, code: "123456" }]
              : path === "/v1/auth/email/verify"
                ? [200, { email: "ana@acme.test", session: "s", expiresAt: "2026-11-01" }]
                : path === "/v1/me"
                  ? [
                      200,
                      {
                        email: "ana@acme.test",
                        workspaces: [],
                        joinable: ["one", "two"].map((slug) => ({
                          slug,
                          name: slug,
                          allowedDomains: ["acme.test"],
                          joinReason: "domain",
                        })),
                      },
                    ]
                  : [200, {}],
        });
        const core = yield* Layer.build(coreLayer(yield* seedState(signedInSeed(hub.url))));
        yield* Effect.gen(function* () {
          yield* (yield* PeerStatus.PeerStatus).coordinationFrom(() =>
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
          const service = yield* PeerWorkspaces.PeerWorkspaces;
          yield* service.startSignIn({ email: "ana@acme.test" });
          const status = yield* service.finishSignIn({ code: "123456" });
          assert.lengthOf(status.domainOffers ?? [], 2);
          assert.isFalse(hub.calls.some((c) => c.url?.endsWith("/join")));
          yield* service.joinWorkspace({ workspace: "one", confirmDomainMatch: true });
          assert.deepStrictEqual(
            Schema.decodeUnknownSync(Schema.UnknownFromJsonString)(
              hub.calls.find((c) => c.url === "/v1/workspaces/one/join")!.body,
            ),
            { confirmDomainMatch: true },
          );
          yield* service.joinWorkspace({ workspace: "two" });
          assert.deepStrictEqual(
            Schema.decodeUnknownSync(Schema.UnknownFromJsonString)(
              hub.calls.find((c) => c.url === "/v1/workspaces/two/join")!.body,
            ),
            {},
          );
        }).pipe(Effect.provide(core));
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
