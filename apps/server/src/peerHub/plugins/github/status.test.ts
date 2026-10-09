import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import { coreLayer, paymentsSeed, seedState, standInHub } from "../../core/testkit.ts";
import { GitHubVerification, layer } from "./status.ts";
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
describe("GitHub verification status", () => {
  it.effect(
    "decodes member and admin answers, composes only its own endpoint, and retains cache on failure",
    () =>
      Effect.gen(function* () {
        let mode: "member" | "admin" | "missing" | "broken" = "member";
        const hub = yield* standInHub({
          current: () =>
            mode === "missing"
              ? [404, {}]
              : mode === "broken"
                ? [503, {}]
                : [
                    200,
                    {
                      configured: true,
                      webhookPath: "/v1/workspaces/acme/github/webhook",
                      lastPingAt: null,
                      lastVerifiedAt: "2026-10-09T12:00:00Z",
                      repositories: [],
                      ...(mode === "admin" ? { secret: "present" } : {}),
                    },
                  ],
        });
        const core = yield* Layer.build(
          coreLayer(yield* seedState(paymentsSeed(hub.url)), { session: "s" }),
        );
        const service = yield* Effect.gen(function* () {
          yield* (yield* PeerStatus.PeerStatus).coordinationFrom(() =>
            Effect.succeed(coordination),
          );
          return Context.get(yield* Layer.build(layer), GitHubVerification);
        }).pipe(Effect.provide(core));
        const member = yield* service.status("acme");
        assert.isUndefined(member.secret);
        assert.strictEqual(member.webhookUrl, `${hub.url}/v1/workspaces/acme/github/webhook`);
        mode = "admin";
        assert.strictEqual((yield* service.status("acme")).secret, "present");
        mode = "broken";
        assert.isTrue(Result.isFailure(yield* service.status("acme").pipe(Effect.result)));
        assert.isTrue((yield* service.snapshot)[0]?.configured);
        mode = "missing";
        assert.isTrue((yield* service.status("acme")).unsupported);
        assert.isFalse((yield* service.snapshot)[0]?.configured);
        yield* service.forget("acme");
        assert.deepStrictEqual(yield* service.snapshot, []);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
