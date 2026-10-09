// @effect-diagnostics nodeBuiltinImport:off - a stand-in hub on a local HTTP port.
import * as NodeHttp from "node:http";
import type * as NodeNet from "node:net";

import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { FetchHttpClient } from "effect/unstable/http";

import * as HubApi from "./hubApi.ts";

describe("whether a failed Hub call applied anything", () => {
  it.effect("marks only an explicit 4xx rejection, including an unreadable body", () =>
    Effect.gen(function* () {
      const api = yield* HubApi.make;
      for (const [status, body] of [
        [409, '{"error":{"code":"conflict","message":"Already changed."}}'],
        [400, '{"error":{"code":"invalid","message":"Invalid."}}'],
        [401, '{"error":{"code":"unauthenticated","message":"Ended."}}'],
        [403, ""],
        [500, '{"error":{"code":"error","message":"Failed."}}'],
        [502, ""],
        [200, "not json"],
        [200, '{"unexpected":true}'],
      ] as const) {
        const hub = yield* standInHub((response) => response.writeHead(status).end(body));
        const result = yield* api
          .request(Schema.Struct({ ok: Schema.Boolean }), {
            hubUrl: hub.url,
            path: "/v1/workspaces/acme/events",
            method: "POST",
            body: {},
          })
          .pipe(Effect.result);
        assert.isTrue(Result.isFailure(result));
        if (Result.isFailure(result)) {
          assert.strictEqual(
            result.failure.refused,
            status >= 400 && status < 500 ? true : undefined,
          );
          if (status === 401) assert.isTrue(HubApi.isSessionEnded(result.failure));
        }
      }
      assert.isTrue(HubApi.isSignedOut({ detail: HubApi.SIGN_IN_FIRST }));
      assert.isTrue(
        HubApi.isSignedOut({ detail: "Your session with the hub ended. Sign in again." }),
      );
      assert.isFalse(HubApi.isSignedOut({ detail: "Some other failure" }));
    }).pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer)),
  );
  it.live("leaves connection loss and a timeout unknown", () =>
    Effect.gen(function* () {
      const api = yield* HubApi.make;
      for (const respond of [
        (response: NodeHttp.ServerResponse) => response.destroy(),
        () => undefined,
      ]) {
        const hub = yield* standInHub(respond);
        const result = yield* api
          .request(Schema.Struct({ ok: Schema.Boolean }), {
            hubUrl: hub.url,
            path: "/v1/workspaces/acme/events",
            method: "POST",
            body: {},
            timeoutMs: 100,
          })
          .pipe(
            Effect.ensuring(Effect.sync(() => hub.server.closeAllConnections())),
            Effect.result,
          );
        assert.isTrue(Result.isFailure(result) && result.failure.refused === undefined);
      }
    }).pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer)),
  );
});

/** A hub that answers `path` (by default the acme workspace's events) with `respond`. */
const standInHub = (
  respond: (response: NodeHttp.ServerResponse) => void,
  path = "/v1/workspaces/acme/events",
) =>
  Effect.acquireRelease(
    Effect.promise(
      () =>
        new Promise<{ readonly url: string; readonly server: NodeHttp.Server }>((resolve) => {
          const server = NodeHttp.createServer((request, response) => {
            if (request.url === path) respond(response);
            else response.writeHead(404).end();
          });
          server.listen(0, "127.0.0.1", () =>
            resolve({
              url: `http://127.0.0.1:${(server.address() as NodeNet.AddressInfo).port}`,
              server,
            }),
          );
        }),
    ),
    ({ server }) =>
      Effect.promise(() => {
        server.closeAllConnections();
        return new Promise<void>((done) => server.close(() => done()));
      }),
  );

describe("hub events", () => {
  // Every named ping passes, one no Peer knows yet included: the follower drops those nobody
  // follows (PeerHubEvents).
  it.effect("passes on every named ping, with the environment that caused it and its data", () =>
    Effect.gen(function* () {
      const hub = yield* standInHub((response) => {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.end(
          [
            'event: work\ndata: {"origin":"bob-laptop"}\n\n',
            ":\n\n",
            "event: gossip\ndata: {}\n\n",
            'event: coord\ndata: {"origin":null}\n\n',
            "event: resync\ndata: {}\n\n",
            'event: observe\ndata: {"origin":null,"environment":"ana-laptop","thread":"peer:1"}\n\n',
          ].join(""),
        );
      });
      const api = yield* HubApi.make;
      const pings = yield* Stream.runCollect(api.events(hub.url, "phs_test", "acme"));
      assert.deepStrictEqual(Array.from(pings), [
        { change: "work", origin: "bob-laptop", data: {} },
        { change: "gossip", origin: null, data: {} },
        { change: "coord", origin: null, data: {} },
        { change: "resync", origin: null, data: {} },
        {
          change: "observe",
          origin: null,
          data: { environment: "ana-laptop", thread: "peer:1" },
        },
      ]);
    }).pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer)),
  );

  it.effect("keeps a ping's scalar fields and drops what is no ping", () =>
    Effect.gen(function* () {
      const hub = yield* standInHub((response) => {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.end(
          [
            'data: {"origin":"bob-laptop"}\n\n',
            'event: memory.changed\ndata: {"origin":"bob-laptop","projectId":"pay","cursor":12,"critical":true,"note":null,"paths":["a"],"by":{"email":"bob@acme.test"}}\n\n',
            "event: plans.updated\ndata: not json\n\n",
          ].join(""),
        );
      });
      const api = yield* HubApi.make;
      const pings = yield* Stream.runCollect(api.events(hub.url, "phs_test", "acme"));
      assert.deepStrictEqual(Array.from(pings), [
        {
          change: "memory.changed",
          origin: "bob-laptop",
          data: { projectId: "pay", cursor: 12, critical: true, note: null },
        },
        { change: "plans.updated", origin: null, data: {} },
      ]);
    }).pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer)),
  );

  it.effect("tells a hub without pings from one that refused the session", () =>
    Effect.gen(function* () {
      const without = yield* standInHub((response) => response.writeHead(404).end());
      const api = yield* HubApi.make;
      const missing = yield* Stream.runDrain(api.events(without.url, "phs_test", "acme")).pipe(
        Effect.result,
      );
      assert.isTrue(Result.isFailure(missing) && HubApi.isWithoutEvents(missing.failure));

      const ended = yield* standInHub((response) => response.writeHead(401).end());
      const refused = yield* Stream.runDrain(api.events(ended.url, "phs_test", "acme")).pipe(
        Effect.result,
      );
      assert.isTrue(Result.isFailure(refused) && HubApi.isSessionEnded(refused.failure));
    }).pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer)),
  );
});
