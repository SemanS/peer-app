// @effect-diagnostics nodeBuiltinImport:off - a stand-in hub on a local HTTP port.
import * as NodeHttp from "node:http";
import type * as NodeNet from "node:net";

import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { FetchHttpClient } from "effect/http";

import * as CoordApi from "./coordApi.ts";
import * as HubApi from "./hubApi.ts";

/** A hub that answers every request with `respond`, and keeps what it was asked. */
const recordingHub = (
  respond: (request: NodeHttp.IncomingMessage, response: NodeHttp.ServerResponse) => void,
) =>
  Effect.acquireRelease(
    Effect.promise(
      () =>
        new Promise<{
          readonly url: string;
          readonly server: NodeHttp.Server;
          readonly requests: Array<{
            readonly method: string | undefined;
            readonly url: string | undefined;
            readonly authorization: string | undefined;
            readonly body: unknown;
          }>;
        }>((resolve) => {
          const requests: Array<{
            method: string | undefined;
            url: string | undefined;
            authorization: string | undefined;
            body: unknown;
          }> = [];
          const server = NodeHttp.createServer((request, response) => {
            let raw = "";
            request.setEncoding("utf8");
            request.on("data", (chunk: string) => (raw += chunk));
            request.on("end", () => {
              requests.push({
                method: request.method,
                url: request.url,
                authorization: request.headers.authorization,
                body: raw === "" ? undefined : JSON.parse(raw),
              });
              respond(request, response);
            });
          });
          server.listen(0, "127.0.0.1", () =>
            resolve({
              url: `http://127.0.0.1:${(server.address() as NodeNet.AddressInfo).port}`,
              server,
              requests,
            }),
          );
        }),
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

const json = (response: NodeHttp.ServerResponse, status: number, body: unknown) =>
  response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));

const record = {
  id: "abc123def456",
  project: "app",
  sessions: ["claude:ana", "claude:bob"],
  files: ["src/pay.ts"],
  openedAt: "2026-10-06T10:00:00Z",
  updatedAt: "2026-10-06T10:00:01Z",
} satisfies CoordApi.HubOverlap;

describe("telling the hub of an edit", () => {
  const request = {
    environment: "ana-laptop",
    session: "claude:bob",
    paths: ["src/pay.ts"],
    op: "op-1",
  } as const;

  it.effect("asks for a verdict on each path, and reads the overlaps it carries", () =>
    Effect.gen(function* () {
      const answer = {
        verdicts: [
          {
            path: "src/pay.ts",
            verdict: "notify",
            with: ["claude:ana"],
            overlaps: ["abc123def456"],
          },
        ],
        overlaps: [record],
        at: "2026-10-06T10:00:02Z",
      } satisfies CoordApi.HubIntentAnswer;
      const hub = yield* recordingHub((_request, response) => json(response, 200, answer));
      const api = yield* HubApi.make;
      const told = yield* api.intent(hub.url, "phs_test", "acme", "app", request);
      assert.deepStrictEqual(told, answer);
      assert.deepStrictEqual(hub.requests, [
        {
          method: "POST",
          url: "/v1/workspaces/acme/coord/app/intent",
          authorization: "Bearer phs_test",
          body: request,
        },
      ]);
    }).pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer)),
  );

  it.effect("reads what a hub keeps sending for one release, and ignores it", () =>
    Effect.gen(function* () {
      const answer = {
        policy: "notify",
        policySource: "project",
        verdicts: [
          {
            path: "src/pay.ts",
            verdict: "notify",
            with: ["claude:ana"],
            overlaps: ["abc123def456"],
          },
        ],
        overlaps: [{ ...record, state: "open", notes: [] }],
        at: "2026-10-06T10:00:02Z",
      };
      const hub = yield* recordingHub((_request, response) => json(response, 200, answer));
      const api = yield* HubApi.make;
      const told = yield* api.intent(hub.url, "phs_test", "acme", "app", request);
      assert.deepStrictEqual(told.overlaps, [record]);
      assert.notProperty(told, "policy");
    }).pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer)),
  );

  it.effect("fails, rather than guess, when the hub refuses or answers something else", () =>
    Effect.gen(function* () {
      const api = yield* HubApi.make;
      const refusing = yield* recordingHub((_request, response) =>
        json(response, 403, {
          error: { code: "not_your_session", message: "that session is not yours" },
        }),
      );
      const refused = yield* api
        .intent(refusing.url, "phs_test", "acme", "app", request)
        .pipe(Effect.result);
      assert.isTrue(
        Result.isFailure(refused) && refused.failure.detail === "that session is not yours",
      );

      const broken = yield* recordingHub((_request, response) =>
        json(response, 200, { verdicts: "yes" }),
      );
      const unexpected = yield* api
        .intent(broken.url, "phs_test", "acme", "app", request)
        .pipe(Effect.result);
      assert.isTrue(
        Result.isFailure(unexpected) && unexpected.failure.detail.includes("unexpected shape"),
      );
    }).pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer)),
  );

  it.live("gives up on a hub that does not answer within the time it was given", () =>
    Effect.gen(function* () {
      const silent = yield* recordingHub(() => undefined);
      const api = yield* HubApi.make;
      const gone = yield* api
        .intent(silent.url, "phs_test", "acme", "app", request, { timeoutMs: 100 })
        .pipe(Effect.result);
      assert.isTrue(
        Result.isFailure(gone) && gone.failure.detail.includes("Could not reach the hub"),
      );
    }).pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer)),
  );

  it.effect("reads a view as a hub sends it, with what it keeps for one release", () =>
    Effect.gen(function* () {
      const api = yield* HubApi.make;
      const hub = yield* recordingHub((_request, response) =>
        json(response, 200, {
          sessions: [],
          overlaps: [{ ...record, state: "open", notes: [] }, record],
          at: "2026-10-06T10:00:02Z",
        }),
      );
      const view = yield* api.coordination(hub.url, "phs_test", "acme");
      assert.deepStrictEqual(view.overlaps, [record, record]);
    }).pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer)),
  );
});

describe("hub events", () => {
  it.effect("reads the filtered committed coordination history", () =>
    Effect.gen(function* () {
      const event = {
        id: "one",
        kind: "claim",
        project: "app",
        at: "2026-10-06T10:00:00Z",
        paths: ["src/a b.ts"],
        participants: ["claude:ana"],
      };
      const hub = yield* recordingHub((_request, response) => json(response, 200, [event]));
      const api = yield* HubApi.make;
      assert.deepStrictEqual(
        yield* api.coordEvents(hub.url, "phs_test", "acme", "app", {
          task: "build",
          path: "src/a b.ts",
          limit: 20,
        }),
        [event],
      );
      assert.strictEqual(
        hub.requests[0]?.url,
        "/v1/workspaces/acme/coord/app/events?task=build&path=src%2Fa%20b.ts&limit=20",
      );
    }).pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer)),
  );
});
