// @effect-diagnostics preferSchemaOverJson:off - the bodies the Hub was sent; PEER_AGREEMENTS is read from the environment.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  PEER_AGREEMENTS_METHODS as methods,
  PEER_AGREEMENTS_PLUGIN,
  PEER_PLUGIN_IDS,
  PeerHubError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";

import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import * as PeerPlugins from "../../core/plugins/PeerPlugins.ts";
import { peerPlugins } from "../../core/registry.ts";
import {
  coreLayer,
  meAnswer,
  seedState,
  signedInSeed,
  standInHub,
  type HubAnswer,
} from "../../core/testkit.ts";
import {
  ACME,
  acmeHub,
  agreementOf,
  agreementsPeer,
  agreementsWhen,
  closedOf,
  hasWorkspace,
  refusedWith,
  rpcOver,
  VIEW,
  viewOf,
  type Route,
} from "./fixtures.test.ts";
import { AgreementsPlugin } from "./index.ts";

/** Core signed in to a stand-in Hub that answers `answer`, with the agreements plugin registered. */
const agreementsCore = (answer: { current: HubAnswer }) =>
  Effect.gen(function* () {
    const hub = yield* standInHub(answer);
    const core = yield* Layer.build(
      coreLayer(yield* seedState(signedInSeed(hub.url)), {
        session: "phs_test",
        plugins: [AgreementsPlugin],
      }),
    );
    return yield* Effect.gen(function* () {
      yield* PeerPlugins.startPlugins;
      return {
        plugins: yield* PeerPlugins.PeerPlugins,
        client: yield* PeerHubClient.PeerHubClient,
      };
    }).pipe(Effect.provide(core));
  });

const state = (core: Effect.Success<ReturnType<typeof agreementsCore>>) =>
  core.plugins.states.pipe(Effect.map((states) => states.find(({ id }) => id === "agreements")));

const refusal = <A>(effect: Effect.Effect<A, PeerHubError>) =>
  effect.pipe(
    Effect.result,
    Effect.map((result) => (Result.isFailure(result) ? result.failure.detail : null)),
  );

/** `PEER_AGREEMENTS` set to `value` (unset when undefined) while `effect` runs. */
const withEnvironment = <A, E, R>(value: string | undefined, effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const before = process.env.PEER_AGREEMENTS;
      if (value === undefined) delete process.env.PEER_AGREEMENTS;
      else process.env.PEER_AGREEMENTS = value;
      return before;
    }),
    () => effect,
    (before) =>
      Effect.sync(() => {
        if (before === undefined) delete process.env.PEER_AGREEMENTS;
        else process.env.PEER_AGREEMENTS = before;
      }),
  );

describe("the agreements plugin", () => {
  it("is defined as the contracts say, and needs the Hub's agreements feature", () => {
    assert.strictEqual(AgreementsPlugin.id, "agreements");
    assert.strictEqual(AgreementsPlugin.title, "Agreements");
    assert.strictEqual(AgreementsPlugin.summary, PEER_AGREEMENTS_PLUGIN.summary);
    assert.isTrue(AgreementsPlugin.defaultEnabled);
    assert.deepStrictEqual(AgreementsPlugin.hubFeature, { id: "agreements", revision: 1 });
    assert.isUndefined(AgreementsPlugin.forcedOff?.());
  });

  it("is listed once, in the contracts' order: plans, then agreements, then settings", () => {
    const listed = peerPlugins().map((entry) => entry.id);
    assert.deepStrictEqual(listed, [...PEER_PLUGIN_IDS]);
    assert.strictEqual(listed.indexOf("agreements"), listed.indexOf("plans") + 1);
    assert.strictEqual(listed.indexOf("agreements") + 1, listed.indexOf("settings"));
  });

  it.effect("is active where the Hub serves agreements, and says why where it does not", () =>
    withEnvironment(
      undefined,
      Effect.gen(function* () {
        const answer: { current: HubAnswer } = { current: () => [200, meAnswer()] };
        const core = yield* agreementsCore(answer);
        // No Hub answered yet: the plugin waits for one, it does not need a newer one.
        assert.strictEqual((yield* state(core))?.reason, "hub-unknown");
        assert.isFalse(yield* core.plugins.isActive("agreements"));

        answer.current = () => [200, meAnswer({ requests: 1, agreements: 1 })];
        yield* core.client.me;
        assert.deepStrictEqual(yield* state(core), {
          id: "agreements",
          title: "Agreements",
          enabled: true,
          active: true,
        });

        // An older Hub lists no such feature: its settles keep nothing, and this app does nothing for it.
        answer.current = () => [200, meAnswer({ requests: 1 })];
        yield* core.client.me;
        assert.deepStrictEqual(yield* state(core), {
          id: "agreements",
          title: "Agreements",
          enabled: true,
          active: false,
          reason: "hub",
        });
        assert.strictEqual(
          yield* refusal(core.plugins.requireActive("agreements")),
          "Agreements needs a newer Peer Hub.",
        );

        // Its operator turned it off: the Hub lists it as off, and does not serve it.
        answer.current = () => [200, meAnswer({ requests: 1 }, { featuresOff: ["agreements"] })];
        yield* core.client.me;
        assert.isFalse(yield* core.plugins.isActive("agreements"));
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    ),
  );

  it.effect("is turned off by its owner, and the choice survives the Hub serving the feature", () =>
    withEnvironment(
      undefined,
      Effect.gen(function* () {
        const answer: { current: HubAnswer } = {
          current: () => [200, meAnswer({ agreements: 1 })],
        };
        const core = yield* agreementsCore(answer);
        yield* core.client.me;
        assert.isTrue(yield* core.plugins.isActive("agreements"));
        yield* core.plugins.setPlugin({ id: "agreements", enabled: false });
        assert.deepStrictEqual(yield* state(core), {
          id: "agreements",
          title: "Agreements",
          enabled: false,
          active: false,
          reason: "off",
        });
        assert.strictEqual(
          yield* refusal(core.plugins.requireActive("agreements")),
          "Agreements is turned off on this environment.",
        );
        yield* core.plugins.setPlugin({ id: "agreements", enabled: true });
        assert.isTrue(yield* core.plugins.isActive("agreements"));
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    ),
  );

  it.effect("is forced off by PEER_AGREEMENTS=off, and the switch cannot turn it on", () =>
    withEnvironment(
      "off",
      Effect.gen(function* () {
        const answer: { current: HubAnswer } = {
          current: () => [200, meAnswer({ agreements: 1 })],
        };
        const core = yield* agreementsCore(answer);
        yield* core.client.me;
        assert.deepStrictEqual(yield* state(core), {
          id: "agreements",
          title: "Agreements",
          enabled: false,
          active: false,
          reason: "PEER_AGREEMENTS=off",
          locked: true,
        });
        assert.include(
          (yield* refusal(core.plugins.setPlugin({ id: "agreements", enabled: true })))!,
          "PEER_AGREEMENTS=off",
        );
        assert.isFalse(yield* core.plugins.isActive("agreements"));
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    ),
  );

  it.effect("reads PEER_AGREEMENTS each time, and any value but off leaves the plugin on", () =>
    withEnvironment(
      "on",
      Effect.gen(function* () {
        const answer: { current: HubAnswer } = {
          current: () => [200, meAnswer({ agreements: 1 })],
        };
        const core = yield* agreementsCore(answer);
        yield* core.client.me;
        assert.isTrue(yield* core.plugins.isActive("agreements"));
        process.env.PEER_AGREEMENTS = "off";
        assert.strictEqual((yield* state(core))?.locked, true);
        delete process.env.PEER_AGREEMENTS;
        assert.isTrue(yield* core.plugins.isActive("agreements"));
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    ),
  );
});

describe("the apps' methods", () => {
  const ID = "3f9a0c1b2d4e5f60";
  const sent = (hub: {
    readonly calls: ReadonlyArray<{
      readonly method: string | undefined;
      readonly url: string | undefined;
      readonly body: string;
    }>;
  }) =>
    hub.calls
      .filter((call) => call.method !== "GET")
      .map((call) => [call.method, call.url, call.body] as const);

  it.effect(
    "read the Hub's agreements of a workspace or of one project, and keep what it said",
    () =>
      Effect.gen(function* () {
        const other = agreementOf({ id: "b1", project: "web", tasks: ["w-1", "w-2"] });
        const current = { view: viewOf([agreementOf(), other]) };
        const hub = yield* standInHub({ current: acmeHub(current) });
        const peer = yield* agreementsPeer(hub);
        yield* agreementsWhen(peer.status, hasWorkspace);
        const rpc = yield* rpcOver(peer.plugins);
        assert.deepStrictEqual(
          yield* rpc[methods.peerAgreementsView]({ workspace: "acme" }),
          current.view,
        );
        const project = yield* rpc[methods.peerAgreementsView]({
          workspace: "acme",
          project: "app",
        });
        assert.deepStrictEqual(
          project.agreements.map((agreement) => agreement.id),
          [ID],
        );
        assert.include(
          hub.calls.map((call) => call.url),
          `${VIEW}?project=app`,
        );

        // What the Hub said now is what the status counts.
        current.view = viewOf([
          agreementOf(),
          other,
          agreementOf({ id: "c2", tasks: ["krk-1", "krk-3"] }),
        ]);
        yield* rpc[methods.peerAgreementsView]({ workspace: "acme" });
        assert.strictEqual((yield* peer.status.publish).agreements?.workspaces[0]?.open, 3);

        // A workspace the person is not in, or a project they are not on, is no business of the Hub's.
        const before = hub.calls.length;
        for (const place of [{ workspace: "beta" }, { workspace: "acme", project: "secret" }]) {
          assert.isTrue(
            Result.isFailure(yield* rpc[methods.peerAgreementsView](place).pipe(Effect.result)),
          );
        }
        assert.strictEqual(hub.calls.length, before);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "close an agreement as handled or not needed, reopen it, and read the Hub again each time",
    () =>
      Effect.gen(function* () {
        const current: { view: ReturnType<typeof viewOf>; route?: Route } = {
          view: viewOf(),
          route: (url) => {
            if (url === `${ACME}/agreements/app/${ID}/close`)
              return [
                200,
                {
                  agreement: closedOf({
                    closed: { at: "2026-10-13T12:30:00Z", by: "ana@acme.test", why: "handled" },
                  }),
                },
              ];
            if (url === `${ACME}/agreements/app/${ID}/reopen`)
              return [200, { agreement: agreementOf() }];
            return undefined;
          },
        };
        const hub = yield* standInHub({ current: acmeHub(current) });
        const peer = yield* agreementsPeer(hub);
        yield* agreementsWhen(peer.status, hasWorkspace);
        const rpc = yield* rpcOver(peer.plugins);
        const open = () =>
          peer.status.publish.pipe(Effect.map((status) => status.agreements?.workspaces[0]?.open));
        assert.strictEqual(yield* open(), 1);

        current.view = viewOf([closedOf()]);
        const closed = yield* rpc[methods.peerAgreementsClose]({
          workspace: "acme",
          project: "app",
          id: ID,
          why: "handled",
        });
        assert.strictEqual(closed.agreement.state, "closed");
        assert.strictEqual(closed.agreement.closed?.why, "handled");
        // The snapshot was read again: nothing is open now.
        assert.strictEqual(yield* open(), 0);

        current.view = viewOf();
        const reopened = yield* rpc[methods.peerAgreementsReopen]({
          workspace: "acme",
          project: "app",
          id: ID,
        });
        assert.strictEqual(reopened.agreement.state, "open");
        assert.strictEqual(yield* open(), 1);

        yield* rpc[methods.peerAgreementsClose]({
          workspace: "acme",
          project: "app",
          id: ID,
          why: "not-needed",
        }).pipe(Effect.result);
        assert.deepStrictEqual(sent(hub), [
          ["POST", `${ACME}/agreements/app/${ID}/close`, '{"why":"handled"}'],
          ["POST", `${ACME}/agreements/app/${ID}/reopen`, "{}"],
          ["POST", `${ACME}/agreements/app/${ID}/close`, '{"why":"not-needed"}'],
        ]);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("pass on what the Hub refuses, with its words and code, and read nothing again", () =>
    Effect.gen(function* () {
      const current: { view: ReturnType<typeof viewOf>; route?: Route } = {
        view: viewOf(),
        route: (url) =>
          url.startsWith(`${ACME}/agreements/app/`)
            ? [
                409,
                {
                  error: {
                    code: "agreement_state",
                    message: "That agreement was closed already.",
                    details: { state: "closed", why: "handled" },
                  },
                },
              ]
            : undefined,
      };
      const hub = yield* standInHub({ current: acmeHub(current) });
      const peer = yield* agreementsPeer(hub);
      yield* agreementsWhen(peer.status, hasWorkspace);
      const rpc = yield* rpcOver(peer.plugins);
      const reads = () => hub.calls.filter((call) => call.url === VIEW).length;
      const before = reads();
      const refused = yield* refusedWith(
        rpc[methods.peerAgreementsClose]({
          workspace: "acme",
          project: "app",
          id: ID,
          why: "handled",
        }),
      );
      assert.strictEqual(refused.detail, "That agreement was closed already.");
      assert.strictEqual(refused.code, "agreement_state");
      assert.strictEqual(refused.status, 409);
      assert.isTrue(refused.refused);
      const again = yield* refusedWith(
        rpc[methods.peerAgreementsReopen]({ workspace: "acme", project: "app", id: ID }),
      );
      assert.strictEqual(again.code, "agreement_state");
      assert.strictEqual(reads(), before);

      // A Hub that lacks the route says so, and so does the app.
      current.route = () => [404, { error: { code: "not_found", message: "no such route" } }];
      const lacking = yield* refusedWith(
        rpc[methods.peerAgreementsClose]({
          workspace: "acme",
          project: "app",
          id: ID,
          why: "handled",
        }),
      );
      assert.strictEqual(lacking.detail, "Agreements need a newer Peer Hub.");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("ask nothing of the Hub for a project the person is not on", () =>
    Effect.gen(function* () {
      const hub = yield* standInHub({ current: acmeHub({ view: viewOf() }) });
      const peer = yield* agreementsPeer(hub);
      yield* agreementsWhen(peer.status, hasWorkspace);
      const rpc = yield* rpcOver(peer.plugins);
      const before = hub.calls.length;
      for (const failed of [
        yield* rpc[methods.peerAgreementsClose]({
          workspace: "acme",
          project: "secret",
          id: ID,
          why: "handled",
        }).pipe(Effect.result),
        yield* rpc[methods.peerAgreementsReopen]({
          workspace: "beta",
          project: "app",
          id: ID,
        }).pipe(Effect.result),
      ])
        assert.isTrue(Result.isFailure(failed));
      assert.strictEqual(hub.calls.length, before);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("fail while the plugin is off, before anything reaches the Hub", () =>
    Effect.gen(function* () {
      const hub = yield* standInHub({ current: acmeHub({ view: viewOf() }) });
      const peer = yield* agreementsPeer(hub);
      yield* agreementsWhen(peer.status, hasWorkspace);
      const rpc = yield* rpcOver(peer.plugins);
      yield* peer.plugins.setPlugin({ id: "agreements", enabled: false });
      const before = hub.calls.length;
      const input = { workspace: "acme", project: "app", id: ID };
      for (const failed of [
        yield* refusedWith(rpc[methods.peerAgreementsView]({ workspace: "acme" })),
        yield* refusedWith(rpc[methods.peerAgreementsClose]({ ...input, why: "handled" })),
        yield* refusedWith(rpc[methods.peerAgreementsReopen](input)),
      ])
        assert.strictEqual(failed.detail, "Agreements is turned off on this environment.");
      assert.strictEqual(hub.calls.length, before);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
