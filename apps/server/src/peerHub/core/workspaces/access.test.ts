import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as PeerHubClient from "../hub/PeerHubClient.ts";
import * as PeerState from "../state/PeerState.ts";
import * as PeerStatus from "../status/PeerStatus.ts";
import { coreLayer, seedState, signedInSeed, standInHub, type HubAnswer } from "../testkit.ts";
import * as PeerWorkspaces from "./PeerWorkspaces.ts";

const started = (answer: HubAnswer) =>
  Effect.gen(function* () {
    const hub = yield* standInHub({ current: answer });
    const core = yield* Layer.build(
      coreLayer(yield* seedState(signedInSeed(hub.url)), { session: "s" }),
    );
    const services = yield* Effect.gen(function* () {
      yield* (yield* PeerStatus.PeerStatus).coordinationFrom(() =>
        Effect.succeed({
          enabled: false,
          policy: "coordinate",
          claudeHooks: false,
          logPath: "/tmp/access-test",
          sessions: [],
          overlaps: [],
          findings: [],
          contexts: [],
          candidates: [],
        }),
      );
      return {
        workspaces: yield* PeerWorkspaces.PeerWorkspaces,
        client: yield* PeerHubClient.PeerHubClient,
        state: yield* PeerState.PeerState,
      };
    }).pipe(Effect.provide(core));
    return { hub, ...services };
  });
describe("workspace access controls through core", () => {
  it.effect("previews only with GET and keeps the session after unsupported signout", () =>
    Effect.gen(function* () {
      const { hub, workspaces, client, state } = yield* started(() => [404, {}]);
      assert.deepStrictEqual(
        yield* workspaces.removalPlan({ workspace: "acme", email: "bob@acme.test" }),
        { unsupported: true },
      );
      assert.strictEqual(hub.calls[0]?.method, "GET");
      assert.strictEqual(
        hub.calls[0]?.url,
        "/v1/workspaces/acme/members/bob%40acme.test/offboarding",
      );
      const refused = yield* workspaces.signOutEverywhere.pipe(Effect.result);
      assert.isTrue(Result.isFailure(refused));
      if (Result.isFailure(refused))
        assert.strictEqual(
          refused.failure.detail,
          "This hub cannot sign out everywhere. Update Peer Hub.",
        );
      assert.isTrue(Option.isSome(yield* client.storedSession));
      assert.lengthOf((yield* state.read).persisted.workspaces, 1);
      assert.isFalse(hub.calls.some((call) => call.url === "/v1/auth/signout"));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "successful signout everywhere clears Hub state and preserves local checkout records",
    () =>
      Effect.gen(function* () {
        const { hub, workspaces, client, state } = yield* started(() => [200, {}]);
        yield* state.updatePersisted((p) => ({
          ...p,
          localCheckouts: { "acme/pay/api": "/tmp/owned-checkout" },
        }));
        const status = yield* workspaces.signOutEverywhere;
        assert.isFalse(status.signedIn);
        assert.deepStrictEqual(status.workspaces, []);
        assert.isTrue(Option.isNone(yield* client.storedSession));
        assert.strictEqual(
          (yield* state.read).persisted.localCheckouts?.["acme/pay/api"],
          "/tmp/owned-checkout",
        );
        assert.isTrue(
          hub.calls.some(
            (call) => call.url === "/v1/auth/signout-everywhere" && call.method === "POST",
          ),
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "sync shows durable removal and clears expired sessions without deleting checkouts",
    () =>
      Effect.gen(function* () {
        let ended = false;
        const { workspaces, state, client } = yield* started((path) =>
          path === "/v1/me"
            ? ended
              ? [401, { error: { code: "unauthenticated", message: "expired" } }]
              : [
                  200,
                  {
                    email: "ana@acme.test",
                    workspaces: [],
                    joinable: [],
                    removed: [{ slug: "acme", name: "Acme", removedAt: "2026-10-09" }],
                  },
                ]
            : [200, {}],
        );
        const synced = yield* workspaces.sync;
        assert.deepStrictEqual(synced.removedFrom, [
          { slug: "acme", name: "Acme", removedAt: "2026-10-09" },
        ]);
        ended = true;
        const expired = yield* workspaces.sync.pipe(Effect.result);
        assert.isTrue(Result.isFailure(expired));
        assert.isTrue(Option.isNone(yield* client.storedSession));
        assert.deepStrictEqual((yield* state.read).persisted.workspaces, []);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
