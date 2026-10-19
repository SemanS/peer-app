import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";

import {
  coreLayer,
  meAnswer,
  seedState,
  signedInSeed,
  standInHub,
  type HubAnswer,
} from "../../core/testkit.ts";
import { PeerHubClient } from "../../core/hub/PeerHubClient.ts";
import { PeerPlugins, startPlugins } from "../../core/plugins/PeerPlugins.ts";
import { helpText } from "../../core/broker/help.ts";
import { NO_PLUGINS } from "../../core/broker/host.ts";
import { PeerWebhooks, layer } from "./PeerWebhooks.ts";
import { WebhooksPlugin } from "./index.ts";

const errorOf = <A, E extends { readonly message: string }>(effect: Effect.Effect<A, E>) =>
  effect.pipe(
    Effect.result,
    Effect.map((answer) => (Result.isFailure(answer) ? answer.failure.message : null)),
  );

describe("webhooks on the Hub session", () => {
  it.effect("requires an advertised Hub feature, and contributes no agent command", () =>
    Effect.gen(function* () {
      const answer: { current: HubAnswer } = { current: () => [200, meAnswer()] };
      const hub = yield* standInHub(answer);
      const core = yield* Layer.build(
        coreLayer(yield* seedState(signedInSeed(hub.url)), {
          plugins: [WebhooksPlugin],
          session: "phs_test",
        }),
      );
      yield* startPlugins.pipe(Effect.provide(core));
      const plugins = yield* PeerPlugins.pipe(Effect.provide(core));
      const client = yield* PeerHubClient.pipe(Effect.provide(core));
      assert.isFalse(yield* plugins.isActive("webhooks"));
      yield* client.me;
      assert.strictEqual((yield* plugins.states)[0]?.reason, "hub");
      answer.current = () => [200, meAnswer({ webhooks: 1 })];
      yield* client.me;
      assert.isTrue(yield* plugins.isActive("webhooks"));
      const active = yield* plugins.active;
      assert.isFalse(
        helpText("peer", { ...NO_PLUGINS, active })
          .toLowerCase()
          .includes("webhook"),
      );
      answer.current = () => [200, meAnswer({ requests: 1 })];
      yield* client.me;
      assert.isFalse(yield* plugins.isActive("webhooks"));
      yield* plugins.setPlugin({ id: "webhooks", enabled: false });
      assert.strictEqual((yield* plugins.states)[0]?.reason, "off");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("uses authenticated, encoded paths and preserves action results", () =>
    Effect.gen(function* () {
      const hub = yield* standInHub({
        current: (url) =>
          url.endsWith("/requeue")
            ? [200, { requeued: 3 }]
            : url.endsWith("/test")
              ? [200, { delivery: "msg_ping" }]
              : url.includes("/deliveries")
                ? [200, { deliveries: [] }]
                : [200, { revision: "rev_1", webhooks: [] }],
      });
      const core = yield* Layer.build(
        coreLayer(yield* seedState(signedInSeed(hub.url)), { session: "phs_test" }),
      );
      const service = yield* PeerWebhooks.pipe(Effect.provide(layer), Effect.provide(core));
      assert.strictEqual((yield* service.list({ workspace: "acme/team" })).revision, "rev_1");
      assert.deepStrictEqual(
        yield* service.deliveries({
          workspace: "acme/team",
          id: "ci/build",
          state: "failed",
          limit: 7,
        }),
        { deliveries: [] },
      );
      assert.deepStrictEqual(
        yield* service.requeue({ workspace: "acme/team", id: "ci/build", delivery: "msg_1" }),
        { requeued: 3 },
      );
      yield* service.requeue({ workspace: "acme/team", id: "ci/build" });
      assert.strictEqual(
        (yield* service.test({ workspace: "acme/team", id: "ci/build" })).delivery,
        "msg_ping",
      );
      assert.deepStrictEqual(
        hub.calls.map(({ method, url, authorization, body }) => ({
          method,
          url,
          authorization,
          body,
        })),
        [
          {
            method: "GET",
            url: "/v1/workspaces/acme%2Fteam/webhooks",
            authorization: "Bearer phs_test",
            body: "",
          },
          {
            method: "GET",
            url: "/v1/workspaces/acme%2Fteam/webhooks/ci%2Fbuild/deliveries?state=failed&limit=7",
            authorization: "Bearer phs_test",
            body: "",
          },
          {
            method: "POST",
            url: "/v1/workspaces/acme%2Fteam/webhooks/ci%2Fbuild/requeue",
            authorization: "Bearer phs_test",
            body: '{"delivery":"msg_1"}',
          },
          {
            method: "POST",
            url: "/v1/workspaces/acme%2Fteam/webhooks/ci%2Fbuild/requeue",
            authorization: "Bearer phs_test",
            body: "{}",
          },
          {
            method: "POST",
            url: "/v1/workspaces/acme%2Fteam/webhooks/ci%2Fbuild/test",
            authorization: "Bearer phs_test",
            body: "{}",
          },
        ],
      );
      const contributions = yield* WebhooksPlugin.contributions.pipe(Effect.provide(core));
      assert.deepStrictEqual(Object.keys(contributions), ["rpc"]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("distinguishes missing support, a removed webhook and malformed Hub answers", () =>
    Effect.gen(function* () {
      const answer: { current: HubAnswer } = { current: () => [404, {}] };
      const hub = yield* standInHub(answer);
      const core = yield* Layer.build(
        coreLayer(yield* seedState(signedInSeed(hub.url)), { session: "phs_test" }),
      );
      const service = yield* PeerWebhooks.pipe(Effect.provide(layer), Effect.provide(core));
      assert.strictEqual(
        yield* errorOf(service.list({ workspace: "acme" })),
        "This workspace's webhooks are not available on the Hub.",
      );
      assert.strictEqual(
        yield* errorOf(service.test({ workspace: "acme", id: "gone" })),
        "That webhook no longer exists.",
      );
      answer.current = () => [200, { webhooks: "broken" }];
      assert.match(
        (yield* errorOf(service.list({ workspace: "acme" }))) ?? "",
        /unexpected|shape|answer/i,
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("refuses signed-out calls before reaching a Hub", () =>
    Effect.gen(function* () {
      const core = yield* Layer.build(coreLayer(yield* seedState()));
      const service = yield* PeerWebhooks.pipe(Effect.provide(layer), Effect.provide(core));
      assert.strictEqual(yield* errorOf(service.list({ workspace: "acme" })), "Sign in first.");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
