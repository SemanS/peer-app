// @effect-diagnostics preferSchemaOverJson:off - the body the Hub is sent.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { coreLayer, meAnswer, paymentsSeed, seedState, standInHub } from "../../core/testkit.ts";
import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import { hubCalls } from "./hub.ts";
import fixture from "../../../../../../packages/contracts/src/peer/handoff.fixture.json" with { type: "json" };
it.effect("uses four narrow routes and keeps known refusals distinct from older Hub routes", () =>
  Effect.gen(function* () {
    let answer: [number, unknown] = [
      200,
      { package: { ...fixture, extra: "ignored" }, changed: true, extra: "ignored" },
    ];
    const hub = yield* standInHub({ current: () => answer });
    const core = yield* Layer.build(
      coreLayer(yield* seedState(paymentsSeed(hub.url)), { session: "s", plugins: [] }),
    );
    const client = hubCalls(yield* PeerHubClient.PeerHubClient.pipe(Effect.provide(core)));
    const place = { workspace: "acme", projectId: "pay", taskId: "krk-1" };
    assert.strictEqual((yield* client.compose(place, {})).package.number, 2);
    assert.strictEqual(hub.calls.at(-1)?.body, "{}");
    assert.strictEqual(hub.calls.at(-1)?.method, "POST");
    yield* client.compose(place, { environment: "laptop", session: "agent" });
    assert.strictEqual(hub.calls.at(-1)?.body, '{"environment":"laptop","session":"agent"}');
    answer = [200, { packages: [fixture] }];
    assert.strictEqual((yield* client.read(place)).length, 1);
    answer = [200, { summaries: [] }];
    assert.deepStrictEqual(yield* client.list("acme"), []);
    answer = [200, { removed: true }];
    assert.isTrue(yield* client.remove(place));
    assert.strictEqual(hub.calls.at(-1)?.method, "DELETE");
    assert.isTrue(hub.calls.every((c) => c.url?.startsWith("/v1/workspaces/acme/handoffs")));
    for (const [status, message] of [
      [404, "no such route"],
      [405, ""],
      [404, "no such task"],
      [403, "not your session"],
      [409, "not in review"],
    ] as const) {
      answer = [
        status,
        {
          error: {
            code:
              status === 409 ? "not_in_review" : status === 403 ? "not_your_session" : "not_found",
            message,
          },
        },
      ];
      const result = yield* client.read(place).pipe(Effect.result);
      assert.strictEqual(result._tag, "Failure");
      if (result._tag === "Failure")
        assert.include(
          result.failure.detail,
          status === 405 || message === "no such route" ? "cannot store" : message,
        );
    }
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
it.effect.each([3, 2, 1])(
  "sends the session's run and delivery to a Hub at handoff revision %s only if it takes them",
  (revision) =>
    Effect.gen(function* () {
      const runs = [{ id: "run_A", agent: "claude", runtime: "terminal", state: "ended" }];
      const delivery = {
        state: "local" as const,
        evidence: { branch: "feature/dns" },
        observedAt: "2026-10-30T10:00:00Z",
        environment: "laptop",
        vcs: "git" as const,
      };
      const hub = yield* standInHub({
        current: (url) =>
          url === "/v1/me"
            ? [200, meAnswer({ handoff: revision })]
            : [200, { package: { ...fixture, runs }, changed: true }],
      });
      const core = yield* Layer.build(
        coreLayer(yield* seedState(paymentsSeed(hub.url)), { session: "s", plugins: [] }),
      );
      const hubClient = yield* PeerHubClient.PeerHubClient.pipe(Effect.provide(core));
      yield* hubClient.me;
      const client = hubCalls(hubClient);
      const place = { workspace: "acme", projectId: "pay", taskId: "krk-1" };
      const composed = yield* client.compose(place, {
        environment: "laptop",
        session: "agent",
        run: "run_A",
        delivery,
      });
      assert.deepStrictEqual(composed.package.runs, runs);
      assert.strictEqual(
        hub.calls.at(-1)?.body,
        revision >= 3
          ? JSON.stringify({ environment: "laptop", session: "agent", run: "run_A", delivery })
          : revision >= 2
            ? '{"environment":"laptop","session":"agent","run":"run_A"}'
            : '{"environment":"laptop","session":"agent"}',
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
