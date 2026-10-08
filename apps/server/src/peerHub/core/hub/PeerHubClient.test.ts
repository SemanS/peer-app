// @effect-diagnostics nodeBuiltinImport:off - a stand-in hub on a local HTTP port.
import * as NodeHttp from "node:http";
import type * as NodeNet from "node:net";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { coreLayer, seedState } from "../testkit.ts";
import * as PeerState from "../state/PeerState.ts";
import * as PeerHubClient from "./PeerHubClient.ts";

interface Asked {
  readonly method: string | undefined;
  readonly url: string | undefined;
  readonly authorization: string | undefined;
  readonly body: string;
}

/** A hub whose answers `answer` decides, keeping what it was asked. */
const standInHub = (answer: { current: (url: string) => readonly [number, unknown] }) =>
  Effect.acquireRelease(
    Effect.promise(
      () =>
        new Promise<{ readonly url: string; readonly server: NodeHttp.Server; asked: Asked[] }>(
          (resolve) => {
            const asked: Asked[] = [];
            const server = NodeHttp.createServer((request, response) => {
              let body = "";
              request.setEncoding("utf8");
              request.on("data", (chunk: string) => (body += chunk));
              request.on("end", () => {
                asked.push({
                  method: request.method,
                  url: request.url,
                  authorization: request.headers.authorization,
                  body,
                });
                const [status, json] = answer.current(request.url ?? "");
                response
                  .writeHead(status, { "content-type": "application/json" })
                  .end(JSON.stringify(json));
              });
            });
            server.listen(0, "127.0.0.1", () =>
              resolve({
                url: `http://127.0.0.1:${(server.address() as NodeNet.AddressInfo).port}`,
                server,
                asked,
              }),
            );
          },
        ),
    ),
    ({ server }) =>
      Effect.promise(
        () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      ),
  );

/** Ana signed in to `hubUrl`, a member of acme, with plugin choices and a shared checkout. */
const signedInState = (hubUrl: string) =>
  [
    `{"hubUrl":"${hubUrl}","email":"ana@acme.test","pendingSignIn":null,`,
    '"workspaces":[{"slug":"acme","name":"Acme","role":"member","allowedDomains":[],',
    '"manifest":null,"lastSyncAt":null}],"joinable":[],"lastSyncAt":null,',
    '"sharedInstances":{},"localCheckouts":{"acme/pay/app":"/Users/ana/code/pay"},',
    '"sharedThreads":["peer:thread-1"],"plugins":{"find":false}}\n',
  ].join("");

const me = {
  email: "ana@acme.test",
  workspaces: [{ slug: "acme", name: "Acme", allowedDomains: [], role: "member" }],
  joinable: [],
};

describe("the Hub's feature catalog", () => {
  it.effect(
    "is read from /v1/me, assumed for a Hub without one, and kept while the Hub fails",
    () =>
      Effect.gen(function* () {
        const answer: { current: (url: string) => readonly [number, unknown] } = {
          current: () => [200, me],
        };
        const hub = yield* standInHub(answer);
        const baseDir = yield* seedState(signedInState(hub.url));
        const client = yield* PeerHubClient.PeerHubClient.pipe(
          Effect.provide(coreLayer(baseDir, { session: "phs_test" })),
        );

        // Until a Hub says otherwise, it serves what Hubs from before the catalog did.
        assert.deepStrictEqual(yield* client.features, PeerHubClient.LEGACY_HUB_FEATURES);

        answer.current = () => [200, { ...me, features: { requests: 1, observe: 2, plans: 1 } }];
        yield* client.me;
        assert.deepStrictEqual(yield* client.features, { requests: 1, observe: 2, plans: 1 });

        answer.current = () => [200, me];
        yield* client.me;
        assert.deepStrictEqual(yield* client.features, PeerHubClient.LEGACY_HUB_FEATURES);

        answer.current = () => [200, { ...me, features: { observe: 1 } }];
        yield* client.me;
        answer.current = () => [
          503,
          { error: { code: "unavailable", message: "Down for a moment." } },
        ];
        const failed = yield* client.me.pipe(Effect.result);
        assert.isTrue(Result.isFailure(failed) && failed.failure.detail === "Down for a moment.");
        assert.deepStrictEqual(yield* client.features, { observe: 1 });

        assert.isTrue(hub.asked.every((asked) => asked.url === "/v1/me"));
        assert.isTrue(hub.asked.every((asked) => asked.authorization === "Bearer phs_test"));
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("the Hub client", () => {
  it.effect("calls a workspace's endpoints on the session, as plugins do", () =>
    Effect.gen(function* () {
      const hub = yield* standInHub({ current: () => [200, { ok: true }] });
      const baseDir = yield* seedState(signedInState(hub.url));
      const client = yield* PeerHubClient.PeerHubClient.pipe(
        Effect.provide(coreLayer(baseDir, { session: "phs_test" })),
      );
      const answered = yield* client.request(Schema.Struct({ ok: Schema.Boolean }), {
        workspace: "acme team",
        path: "/requests",
        method: "POST",
        body: { op: "one" },
      });
      assert.deepStrictEqual(answered, { ok: true });
      assert.deepStrictEqual(hub.asked, [
        {
          method: "POST",
          url: "/v1/workspaces/acme%20team/requests",
          authorization: "Bearer phs_test",
          body: '{"op":"one"}',
        },
      ]);

      const signedOut = yield* PeerHubClient.PeerHubClient.pipe(
        Effect.provide(coreLayer(yield* seedState(signedInState(hub.url)))),
      );
      const refused = yield* signedOut
        .request(Schema.Struct({ ok: Schema.Boolean }), { workspace: "acme", path: "/requests" })
        .pipe(Effect.result);
      assert.isTrue(Result.isFailure(refused) && refused.failure.detail === "Sign in first.");
      assert.strictEqual(hub.asked.length, 1);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("signs out at the Hub and forgets the person, keeping this computer's choices", () =>
    Effect.gen(function* () {
      const hub = yield* standInHub({ current: () => [200, {}] });
      const baseDir = yield* seedState(signedInState(hub.url));
      const { client, state } = yield* Effect.all({
        client: PeerHubClient.PeerHubClient,
        state: PeerState.PeerState,
      }).pipe(Effect.provide(coreLayer(baseDir, { session: "phs_test" })));

      yield* client.signOut;
      assert.deepStrictEqual(
        hub.asked.map(({ method, url }) => [method, url]),
        [["POST", "/v1/auth/signout"]],
      );
      assert.isTrue(Option.isNone(yield* client.storedSession));
      const { persisted } = yield* state.read;
      assert.strictEqual(persisted.email, null);
      assert.strictEqual(persisted.hubUrl, hub.url);
      assert.deepStrictEqual(persisted.workspaces, []);
      assert.isUndefined(persisted.sharedThreads);
      assert.deepStrictEqual(persisted.localCheckouts, { "acme/pay/app": "/Users/ana/code/pay" });
      assert.deepStrictEqual(persisted.plugins, { find: false });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
