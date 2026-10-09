import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import {
  coreLayer,
  seedState,
  signedInSeed,
  standInHub,
  type HubAnswer,
} from "../../core/testkit.ts";
import { PeerHubClient } from "../../core/hub/PeerHubClient.ts";
import { makeHubClient } from "./hubClient.ts";
const row = {
  id: "one",
  project: "app",
  text: "CI red",
  wake: true,
  author: { kind: "person", email: "ana@example.test" },
  createdAt: "2026-10-09T08:00:00Z",
  expiresAt: "2026-10-10T08:00:00Z",
};
const credential = {
  id: "ci",
  label: "CI",
  createdBy: "ana@example.test",
  createdAt: row.createdAt,
  expiresAt: row.expiresAt,
  uses: 0,
  status: "active",
};
const parseBody = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
describe("announcement Hub transport", () => {
  it.effect("uses the environment session, encoded project paths and exact Hub bodies", () =>
    Effect.gen(function* () {
      let calls: ReadonlyArray<{ readonly method: string | undefined }> = [];
      const hub = yield* standInHub({
        current: (url) =>
          url.endsWith("/sync")
            ? [200, { at: row.createdAt, announcements: [row], delivered: [], rejected: [] }]
            : url.includes("announcement-credentials")
              ? calls.at(-1)?.method === "GET"
                ? [200, { credentials: [{ ...credential, secret: "pan_never_read" }] }]
                : [200, { ...credential, secret: "pan_once" }]
              : calls.at(-1)?.method === "DELETE"
                ? [200, { withdrawn: [row.id] }]
                : calls.at(-1)?.method === "POST"
                  ? [201, { ...row, replaced: [] }]
                  : url.endsWith("/one")
                    ? [
                        200,
                        {
                          ...row,
                          counts: {
                            waiting: 0,
                            "not-following": 0,
                            offered: 0,
                            "model-input": 0,
                            acknowledged: 0,
                          },
                          audience: [],
                        },
                      ]
                    : [200, { at: row.createdAt, announcements: [] }],
      });
      calls = hub.calls;
      const core = yield* Layer.build(
        coreLayer(yield* seedState(signedInSeed(hub.url)), { session: "phs_test" }),
      );
      const client = makeHubClient(yield* PeerHubClient.pipe(Effect.provide(core)));
      const project = { workspace: "acme/team", project: "app/core" };
      yield* client.list(project);
      yield* client.detail({ ...project, id: "one" });
      yield* client.post({
        ...project,
        text: "CI red",
        wake: false,
        topic: "ci",
        op: "retry-1",
        validForMinutes: 60,
      });
      yield* client.withdraw({ ...project, topic: "ci" });
      yield* client.withdraw({ ...project, id: "one" });
      yield* client.sync(project.workspace, "laptop", [
        { project: "app/core", announcement: "one", session: "claude:x", state: "offered" },
      ]);
      expect((yield* client.credentials(project)).credentials[0]).not.toHaveProperty("secret");
      expect((yield* client.createCredential({ ...project, label: "CI" })).secret).toBe("pan_once");
      const revoked = yield* client.revokeCredential({ ...project, id: "ci" });
      expect(revoked).not.toHaveProperty("secret");
      expect(hub.calls.every((call) => call.authorization === "Bearer phs_test")).toBe(true);
      expect(hub.calls[0]?.url).toBe(
        "/v1/workspaces/acme%2Fteam/projects/app%2Fcore/announcements",
      );
      expect(parseBody(hub.calls[2]!.body)).toEqual({
        text: "CI red",
        wake: false,
        topic: "ci",
        op: "retry-1",
        validForMinutes: 60,
      });
      expect(hub.calls[3]?.url).toContain("/announcements?topic=ci");
      expect(parseBody(hub.calls[5]!.body)).toEqual({
        environment: "laptop",
        receipts: [
          { project: "app/core", announcement: "one", session: "claude:x", state: "offered" },
        ],
      });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
  it.effect(
    "maps 404 and 405 to unsupported, 401 to ended session, and never echoes a credential in failures",
    () =>
      Effect.gen(function* () {
        const answer: { current: HubAnswer } = { current: () => [405, ""] };
        const hub = yield* standInHub(answer);
        const core = yield* Layer.build(
          coreLayer(yield* seedState(signedInSeed(hub.url)), { session: "phs_test" }),
        );
        const client = makeHubClient(yield* PeerHubClient.pipe(Effect.provide(core)));
        expect(yield* client.sync("acme", "laptop", [])).toBeNull();
        answer.current = () => [404, {}];
        expect(yield* client.list({ workspace: "acme", project: "app" })).toBeNull();
        answer.current = () => [
          401,
          { error: { code: "unauthenticated", message: "pan_do_not_echo" } },
        ];
        const result = yield* client
          .createCredential({ workspace: "acme", project: "app", label: "CI" })
          .pipe(Effect.result);
        expect(Result.isFailure(result) && result.failure.message).toMatch(/ended/);
        expect(Result.isFailure(result) && result.failure.message).not.toContain("pan_do_not_echo");
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
