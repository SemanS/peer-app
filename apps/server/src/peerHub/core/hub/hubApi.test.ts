// @effect-diagnostics nodeBuiltinImport:off - a stand-in hub on a local HTTP port.
import * as NodeHttp from "node:http";
import type * as NodeNet from "node:net";

import { assert, describe, it } from "@effect/vitest";
import { PeerHubError } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { FetchHttpClient, HttpClient } from "effect/http";

import * as HubApi from "./hubApi.ts";

const isPeerHubError = Schema.is(PeerHubError);

describe("whether a failed Hub call applied anything", () => {
  it.effect("marks only an explicit 4xx rejection, including an unreadable body", () =>
    Effect.gen(function* () {
      const api = yield* HubApi.make;
      for (const [status, body] of [
        [409, '{"error":{"code":"stale_context","message":"Already changed."}}'],
        [400, '{"error":{"code":"invalid","message":"Invalid."}}'],
        [401, '{"error":{"code":"unauthenticated","message":"Ended."}}'],
        [403, '{"error":{"code":"metrics_disabled","message":"Disabled."}}'],
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
          assert.strictEqual(
            result.failure.code,
            status === 409
              ? "stale_context"
              : status === 400
                ? "invalid"
                : status === 401
                  ? "unauthenticated"
                  : status === 403 && body !== ""
                    ? "metrics_disabled"
                    : status === 500
                      ? "error"
                      : undefined,
          );
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
        (response: NodeHttp.ServerResponse) => response.writeHead(200).flushHeaders(),
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
            Effect.timeout("500 millis"),
            Effect.ensuring(Effect.sync(() => hub.server.closeAllConnections())),
            Effect.result,
          );
        assert.isTrue(
          Result.isFailure(result) &&
            isPeerHubError(result.failure) &&
            result.failure.refused === undefined,
        );
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

describe("where a failed Hub call stopped", () => {
  const Answer = Schema.Struct({ ok: Schema.Boolean });
  const refusal = (code: string, message: string) => ({ error: { code, message } });

  /** What a call to the Hub that answers with `status` and `body` (text as it is, else JSON) fails with. */
  const failure = (status: number, body: unknown) =>
    Effect.gen(function* () {
      const api = yield* HubApi.make;
      const hub = yield* standInHub((response) =>
        response.writeHead(status).end(typeof body === "string" ? body : JSON.stringify(body)),
      );
      const result = yield* api
        .request(Answer, {
          hubUrl: hub.url,
          path: "/v1/workspaces/acme/events",
          method: "POST",
          body: {},
        })
        .pipe(Effect.result);
      assert.isTrue(Result.isFailure(result));
      if (!Result.isFailure(result)) throw new Error("the call did not fail");
      // Whatever stopped it, the error says which Hub was asked and what was asked of it.
      assert.strictEqual(result.failure.hubUrl, hub.url);
      assert.strictEqual(result.failure.request, "POST /v1/workspaces/acme/events");
      return result.failure;
    }).pipe(Effect.scoped);

  it.effect("tells the Hub's own error from an answer it could not read", () =>
    Effect.gen(function* () {
      const down = yield* failure(502, refusal("knowledge_down", "knowledge store unavailable"));
      assert.deepStrictEqual(
        [down.kind, down.status, down.code, down.detail],
        ["refused", 502, "knowledge_down", "knowledge store unavailable"],
      );
      const forbidden = yield* failure(403, refusal("forbidden", "only an admin can do that"));
      assert.deepStrictEqual(
        [forbidden.kind, forbidden.status, forbidden.refused],
        ["refused", 403, true],
      );

      // What something in front of the Hub answers has no JSON, and is still a refusal with its status.
      const proxy = yield* failure(502, "<html>Bad gateway</html>");
      assert.deepStrictEqual([proxy.kind, proxy.status, proxy.code], ["refused", 502, undefined]);
      assert.strictEqual(
        proxy.detail,
        "The hub answered /v1/workspaces/acme/events with something other than JSON.",
      );

      // A success the app cannot read is not the Hub refusing anything.
      const notJson = yield* failure(200, "not json");
      assert.deepStrictEqual([notJson.kind, notJson.status], ["invalid", 200]);
      const strange = yield* failure(200, { unexpected: true });
      assert.deepStrictEqual([strange.kind, strange.status], ["invalid", 200]);
      assert.strictEqual(
        strange.detail,
        "The hub's answer to /v1/workspaces/acme/events has an unexpected shape.",
      );
    }).pipe(Effect.provide(FetchHttpClient.layer)),
  );

  it.effect("tells a session the Hub ended from any other 401", () =>
    Effect.gen(function* () {
      const ended = yield* failure(
        401,
        refusal("unauthenticated", "the session ended; sign in again"),
      );
      assert.deepStrictEqual([ended.kind, ended.status, ended.refused], ["signedOut", 401, true]);
      assert.isTrue(HubApi.isSessionEnded(ended));

      // A 401 that is not the Hub saying the session ended (an access proxy, say) is a refusal.
      const proxied = yield* failure(401, "");
      assert.deepStrictEqual([proxied.kind, proxied.status], ["refused", 401]);
    }).pipe(Effect.provide(FetchHttpClient.layer)),
  );

  it.effect("tells a Hub without the route from one that does not know the project", () =>
    Effect.gen(function* () {
      const router = yield* failure(404, refusal("not_found", "no such route"));
      const older = yield* failure(404, "");
      const unknown = yield* failure(404, refusal("not_found", "no workspace `site`"));
      for (const missing of [router, older, unknown]) {
        assert.deepStrictEqual([missing.kind, missing.status], ["refused", 404]);
      }
      assert.deepStrictEqual([router, older, unknown].map(HubApi.isMissingRoute), [
        true,
        true,
        false,
      ]);
      // Only a 404 is a missing route.
      assert.isFalse(HubApi.isMissingRoute(yield* failure(403, "")));
      assert.isFalse(HubApi.isMissingRoute(yield* failure(500, refusal("error", "no such route"))));
    }).pipe(Effect.provide(FetchHttpClient.layer)),
  );

  it.effect(
    "says no answer came when the connection fails, and nothing of how long it waited",
    () =>
      Effect.gen(function* () {
        const api = yield* HubApi.make;
        const hub = yield* standInHub((response) => response.destroy());
        const result = yield* api
          .request(Answer, {
            hubUrl: hub.url,
            path: "/v1/workspaces/acme/events",
            method: "POST",
            body: {},
          })
          .pipe(Effect.result);
        assert.isTrue(Result.isFailure(result));
        if (!Result.isFailure(result)) return;
        assert.deepStrictEqual(
          [result.failure.kind, result.failure.status, result.failure.waitedMs],
          ["unreachable", undefined, undefined],
        );
        assert.strictEqual(result.failure.detail, `Could not reach the hub at ${hub.url}.`);
        assert.strictEqual(result.failure.hubUrl, hub.url);
      }).pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer)),
  );

  it.effect("says how long it waited when the Hub stays silent, on the clock the test sets", () =>
    Effect.gen(function* () {
      const asked = yield* Deferred.make<void>();
      const silent = HttpClient.make(() =>
        Deferred.succeed(asked, undefined).pipe(Effect.andThen(Effect.never)),
      );
      const api = yield* HubApi.make.pipe(Effect.provideService(HttpClient.HttpClient, silent));
      const call = (timeoutMs?: number) =>
        api
          .request(Answer, {
            hubUrl: "https://hub.example.test",
            path: "/v1/workspaces/acme/candidates/pay",
            ...(timeoutMs === undefined ? {} : { timeoutMs }),
          })
          .pipe(Effect.result, Effect.forkScoped);

      const byDefault = yield* call();
      yield* Deferred.await(asked);
      yield* TestClock.adjust("20 seconds");
      const waited = yield* Fiber.join(byDefault);
      assert.isTrue(Result.isFailure(waited));
      if (!Result.isFailure(waited)) return;
      assert.deepStrictEqual(
        [waited.failure.kind, waited.failure.waitedMs, waited.failure.status],
        ["unreachable", 20_000, undefined],
      );
      assert.strictEqual(
        waited.failure.detail,
        "Could not reach the hub at https://hub.example.test.",
      );
      assert.strictEqual(waited.failure.request, "GET /v1/workspaces/acme/candidates/pay");

      const quicker = yield* call(5_000);
      yield* TestClock.adjust("5 seconds");
      const shorter = yield* Fiber.join(quicker);
      assert.strictEqual(Result.isFailure(shorter) ? shorter.failure.waitedMs : null, 5_000);
    }).pipe(Effect.scoped),
  );
});

describe("what a 403 or 422 means to a caller that asks", () => {
  const Answer = Schema.Struct({ ok: Schema.Boolean });
  const refusal = (code: string, details?: unknown) => ({
    error: { code, message: "Refused.", ...(details === undefined ? {} : { details }) },
  });

  it.effect("hands over the details of each, and leaves every other refusal an error", () =>
    Effect.gen(function* () {
      const api = yield* HubApi.make;
      const heard: Array<string> = [];
      const rejected = (status: 403 | 422, code: string, details: unknown) => {
        heard.push(`${status} ${code}`);
        return code === "settings_forbidden" || code === "invalid_settings"
          ? { kind: code, details }
          : undefined;
      };
      /** What the Hub answers with `body` (text as it is, anything else as JSON), asked with or without the hook. */
      const ask = (status: number, body: unknown, asks = true) =>
        Effect.gen(function* () {
          const hub = yield* standInHub((response) =>
            response.writeHead(status).end(typeof body === "string" ? body : JSON.stringify(body)),
          );
          return yield* api
            .request(Answer, {
              hubUrl: hub.url,
              path: "/v1/workspaces/acme/events",
              method: "POST",
              body: {},
              ...(asks ? { rejected } : {}),
            })
            .pipe(Effect.result);
        });

      const refused = {
        refused: [{ path: ["projects", "booking"], label: "Budget", owners: "admins" }],
      };
      const forbidden = yield* ask(403, refusal("settings_forbidden", refused));
      assert.deepStrictEqual(Result.isSuccess(forbidden) ? forbidden.success : null, {
        kind: "settings_forbidden",
        details: refused,
      });
      const diagnostics = {
        diagnostics: [{ severity: "error", at: "projects.booking", message: "Bad." }],
      };
      const invalid = yield* ask(422, refusal("invalid_settings", diagnostics));
      assert.deepStrictEqual(Result.isSuccess(invalid) ? invalid.success : null, {
        kind: "invalid_settings",
        details: diagnostics,
      });
      assert.deepStrictEqual(heard, ["403 settings_forbidden", "422 invalid_settings"]);

      // A code the caller does not map, a caller that does not ask, a 409, a 500 and a body
      // that is no error: each is the error it always was, and says what it said.
      const other = yield* ask(403, refusal("metrics_disabled", { x: 1 }));
      const silent = yield* ask(422, refusal("invalid_settings", diagnostics), false);
      const conflict = yield* ask(409, refusal("settings_conflict", diagnostics));
      const failed = yield* ask(500, refusal("error", diagnostics));
      const bodyless = yield* ask(403, "");
      for (const answer of [other, silent, conflict, failed, bodyless]) {
        assert.isTrue(Result.isFailure(answer));
      }
      assert.strictEqual(Result.isFailure(other) ? other.failure.code : null, "metrics_disabled");
      assert.strictEqual(Result.isFailure(silent) ? silent.failure.code : null, "invalid_settings");
      assert.strictEqual(Result.isFailure(silent) ? silent.failure.refused : null, true);
      assert.strictEqual(Result.isFailure(failed) ? failed.failure.refused : null, undefined);
      assert.isUndefined(Result.isFailure(bodyless) ? bodyless.failure.code : "x");
      assert.deepStrictEqual(heard, [
        "403 settings_forbidden",
        "422 invalid_settings",
        "403 metrics_disabled",
      ]);
    }).pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer)),
  );
});

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
            'event: access\ndata: {"reason":"membership"}\n\n',
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
        { change: "access", origin: null, data: { reason: "membership" } },
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

describe("workspace domain API", () => {
  it.effect("accepts older me answers and ignores future claim states", () =>
    Effect.gen(function* () {
      const hub = yield* standInHub(
        (response) =>
          response.writeHead(200, { "content-type": "application/json" }).end(
            JSON.stringify({
              email: "a@acme.test",
              joinable: [],
              workspaces: [
                {
                  slug: "acme",
                  name: "Acme",
                  role: "member",
                  allowedDomains: ["acme.test"],
                  domainClaims: [
                    { domain: "acme.test", state: "verified" },
                    { domain: "future.test", state: "future" },
                  ],
                },
              ],
              domainOffers: [],
            }),
          ),
        "/v1/me",
      );
      const api = yield* HubApi.make;
      const me = yield* api.me(hub.url, "phs_test");
      assert.deepStrictEqual(me.workspaces[0]?.domainClaims, [
        { domain: "acme.test", state: "verified" },
      ]);
      const old = yield* standInHub(
        (response) =>
          response
            .writeHead(200)
            .end(JSON.stringify({ email: "a@acme.test", joinable: [], workspaces: [] })),
        "/v1/me",
      );
      const older = yield* api.me(old.url, "phs_test");
      assert.isUndefined(older.domainOffers);
      assert.isUndefined(older.removed);
    }).pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer)),
  );
  it.effect("keeps a contested claim refusal readable", () =>
    Effect.gen(function* () {
      const hub = yield* standInHub(
        (response) =>
          response.writeHead(409).end(
            JSON.stringify({
              error: {
                code: "domain_claimed",
                message: "Acme holds @acme.test. Publish peer-hub-verify=record.",
              },
            }),
          ),
        "/v1/workspaces",
      );
      const api = yield* HubApi.make;
      const result = yield* api
        .createWorkspace(hub.url, "s", {
          slug: "other",
          name: "Other",
          allowedDomains: ["acme.test"],
        })
        .pipe(Effect.result);
      assert.isTrue(Result.isFailure(result));
      if (Result.isFailure(result)) assert.include(result.failure.detail, "Acme holds");
    }).pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer)),
  );
});

describe("an agent's move of its task that waits for an owner's call", () => {
  const needed = {
    error: {
      code: "owner_call_needed",
      message: "ana@acme.test decides changes to `src/payments/fees.ts`; ask first",
      details: {
        owner: "ana@acme.test",
        paths: ["src/payments/fees.ts", "src/payments/limits.ts"],
      },
    },
  };
  const move = (hubUrl: string, body: { readonly session?: string }) =>
    HubApi.make.pipe(
      Effect.flatMap((api) =>
        api.updateTask(hubUrl, "phs", "acme", "app", "ord-9", { status: "review", ...body }),
      ),
    );

  it.effect("is answered with whose call and which paths, not failed, for an agent", () =>
    Effect.gen(function* () {
      const hub = yield* standInHub(
        (response) => response.writeHead(409).end(JSON.stringify(needed)),
        "/v1/workspaces/acme/projects/app/tasks/ord-9",
      );
      assert.deepStrictEqual(yield* move(hub.url, { session: "claude:one" }), {
        ownerCallNeeded: needed.error.details,
      });
    }).pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer)),
  );

  it.effect("is a refusal as it was for a person, whose move carries no guard", () =>
    Effect.gen(function* () {
      const hub = yield* standInHub(
        (response) => response.writeHead(409).end(JSON.stringify(needed)),
        "/v1/workspaces/acme/projects/app/tasks/ord-9",
      );
      const failed = yield* move(hub.url, {}).pipe(Effect.flip);
      assert.strictEqual(failed.code, "owner_call_needed");
      assert.strictEqual(failed.refused, true);
      // A 409 of another kind, or details it cannot read, stay what they were for an agent too.
      for (const body of [
        { error: { code: "stale_context", message: "Changed." } },
        { error: { ...needed.error, details: { owner: 7 } } },
      ]) {
        const other = yield* standInHub(
          (response) => response.writeHead(409).end(JSON.stringify(body)),
          "/v1/workspaces/acme/projects/app/tasks/ord-9",
        );
        const refused = yield* move(other.url, { session: "claude:one" }).pipe(Effect.flip);
        assert.strictEqual(refused.refused, true);
      }
    }).pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer)),
  );
});

describe("the local and Hub boundary", () => {
  it.effect("refuses a local workspace before any HTTP call", () =>
    Effect.gen(function* () {
      let requests = 0;
      const hub = yield* standInHub((response) => {
        requests += 1;
        response.writeHead(200).end("{}");
      });
      const api = yield* HubApi.make;
      for (const workspace of ["@local", "%40local"]) {
        const result = yield* api
          .request(Schema.Unknown, {
            hubUrl: hub.url,
            path: `/v1/workspaces/${workspace}/coord`,
            method: "PUT",
            body: { private: "local context" },
          })
          .pipe(Effect.result);
        assert.isTrue(Result.isFailure(result));
        if (Result.isFailure(result)) assert.isTrue(result.failure.refused);
      }
      const stream = yield* Stream.runDrain(api.events(hub.url, "phs_test", "@local")).pipe(
        Effect.result,
      );
      assert.isTrue(Result.isFailure(stream));
      if (Result.isFailure(stream)) assert.isTrue(stream.failure.refused);
      assert.strictEqual(requests, 0);
    }).pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer)),
  );
});
