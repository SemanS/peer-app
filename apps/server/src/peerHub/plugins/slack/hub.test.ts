import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import type { PeerHubError } from "@t3tools/contracts";

import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import {
  coreLayer,
  seedState,
  signedInSeed,
  standInHub,
  type HubAnswer,
} from "../../core/testkit.ts";
import { slackHub } from "./hub.ts";

const SLACK = "/v1/workspaces/acme/slack";
const error = (status: number, code: string, message: string, details?: unknown) =>
  [status, { error: { code, message, ...(details === undefined ? {} : { details }) } }] as const;

/** The Hub's Slack endpoints over a stand-in Hub that answers as `answer.current` says. */
const endpoints = (answer: { current: HubAnswer }) =>
  Effect.gen(function* () {
    const hub = yield* standInHub(answer);
    const core = yield* Layer.build(
      coreLayer(yield* seedState(signedInSeed(hub.url)), { session: "phs_test" }),
    );
    return {
      hub,
      slack: slackHub(yield* PeerHubClient.PeerHubClient.pipe(Effect.provide(core))),
    };
  });

describe("the Hub's Slack endpoints", () => {
  it.effect(
    "opens an ask, and tells an ask that is over, or that Slack is off for, from a failure",
    () =>
      Effect.gen(function* () {
        const answer: { current: HubAnswer } = {
          current: () => [200, { ask: "a_1", state: "posting" }],
        };
        const { hub, slack } = yield* endpoints(answer);
        const opened = yield* slack.open("acme", { waitKey: "k" });
        assert.isFalse(typeof opened === "string" || "off" in opened);
        const call = hub.calls.at(-1);
        assert.strictEqual(call?.method, "PUT");
        assert.strictEqual(call?.url, `${SLACK}/asks`);
        assert.strictEqual(call?.body, '{"waitKey":"k"}');
        assert.strictEqual(call?.authorization, "Bearer phs_test");

        answer.current = () => error(409, "closed", "that ask is over");
        assert.strictEqual(yield* slack.open("acme", {}), "closed");
        answer.current = () => error(409, "slack_off", "Slack is off", { reason: "project-off" });
        assert.deepStrictEqual(yield* slack.open("acme", {}), { off: "project-off" });
        answer.current = () => error(409, "slack_off", "Slack is off");
        assert.deepStrictEqual(yield* slack.open("acme", {}), { off: "off" });
        // Anything else is a failure: a rate limit says so by its code, and is not "refused" as a bad ask.
        answer.current = () => error(429, "slack_busy", "too many asks");
        const busy = yield* slack.open("acme", {}).pipe(Effect.flip);
        assert.strictEqual(busy.code, "slack_busy");
        answer.current = () => error(502, "bad_gateway", "down");
        assert.strictEqual((yield* slack.open("acme", {}).pipe(Effect.flip)).refused, undefined);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("withdraws an ask, and takes an ask the Hub does not have for withdrawn", () =>
    Effect.gen(function* () {
      const answer: { current: HubAnswer } = {
        current: () => [200, { ask: "a_1", state: "withdrawn" }],
      };
      const { hub, slack } = yield* endpoints(answer);
      assert.isNotNull(yield* slack.withdraw("acme", { waitKey: "k", reason: "handled" }));
      assert.strictEqual(hub.calls.at(-1)?.url, `${SLACK}/asks/withdraw`);
      assert.strictEqual(hub.calls.at(-1)?.method, "POST");
      answer.current = () => error(404, "not_found", "no such ask");
      assert.isNull(yield* slack.withdraw("acme", { waitKey: "k", reason: "ended" }));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("reads the answers held for this computer, and reports what became of one", () =>
    Effect.gen(function* () {
      const answer: { current: HubAnswer } = {
        current: () => [
          200,
          {
            answers: [
              {
                answer: "a1",
                ask: "a_1",
                waitKey: "peer:t:req:r",
                kind: "option",
                value: "Safe",
                index: 1,
                at: "2026-10-10T12:00:00Z",
              },
              { answer: "a2", ask: "a_2", waitKey: "k", kind: "text", value: "go", at: "x" },
            ],
          },
        ],
      };
      const { hub, slack } = yield* endpoints(answer);
      const inbox = yield* slack.inbox("acme", "ana laptop/1");
      assert.strictEqual(hub.calls.at(-1)?.url, `${SLACK}/inbox?environment=ana%20laptop%2F1`);
      assert.deepStrictEqual(
        inbox.answers.map((a) => [a.answer, a.waitKey, a.kind, a.value, a.index]),
        [
          ["a1", "peer:t:req:r", "option", "Safe", 1],
          ["a2", "k", "text", "go", undefined],
        ],
      );
      answer.current = () => [200, {}];
      assert.deepStrictEqual(
        yield* slack.report("acme", "a/1", { result: "stale", reason: "handled" }),
        {},
      );
      assert.strictEqual(hub.calls.at(-1)?.url, `${SLACK}/inbox/a%2F1/result`);
      assert.strictEqual(hub.calls.at(-1)?.body, '{"result":"stale","reason":"handled"}');
      answer.current = () => error(404, "not_found", "no such answer");
      assert.isNull(yield* slack.report("acme", "a1", { result: "delivered" }));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("asks the member's and the admin's routes, and says when the Hub has none", () =>
    Effect.gen(function* () {
      const answer: { current: HubAnswer } = {
        current: () => error(404, "not_found", "no such route"),
      };
      const { hub, slack } = yield* endpoints(answer);
      const missing = yield* slack.me({ workspace: "acme" }).pipe(Effect.result);
      assert.isTrue(Result.isFailure(missing));
      assert.strictEqual(
        Result.isFailure(missing) ? missing.failure.detail : "",
        "This Peer Hub has no Slack support yet.",
      );
      answer.current = () => [200, {}];
      const routes: ReadonlyArray<[string, string, Effect.Effect<unknown, PeerHubError>]> = [
        ["GET", "/slack/me", slack.me({ workspace: "acme" })],
        ["PUT", "/slack/me", slack.setMine({ workspace: "acme", enabled: true })],
        ["POST", "/slack/me/link", slack.link({ workspace: "acme" })],
        ["DELETE", "/slack/me/link", slack.unlink({ workspace: "acme" })],
        ["GET", "/slack/admin", slack.admin({ workspace: "acme" })],
        ["POST", "/slack/admin/verify", slack.verify({ workspace: "acme" })],
        ["GET", "/slack/admin/channels", slack.channels({ workspace: "acme" })],
        [
          "PUT",
          "/slack/admin/channels",
          slack.setChannels({ workspace: "acme", default: "C0", intercom: true }),
        ],
        ["POST", "/slack/admin/test", slack.test({ workspace: "acme" })],
        [
          "DELETE",
          "/slack/admin/links/bob%40acme.test",
          slack.unlinkMember({ workspace: "acme", email: "bob@acme.test" }),
        ],
        ["DELETE", "/slack/admin", slack.disconnect({ workspace: "acme" })],
      ];
      for (const [method, path, call] of routes) {
        // The answers here are not their shapes; what is asked of the Hub is what is checked.
        yield* Effect.result(call);
        const last = hub.calls.at(-1);
        assert.deepStrictEqual([last?.method, last?.url], [method, `/v1/workspaces/acme${path}`]);
      }
      assert.strictEqual(
        hub.calls.find((c) => c.url === `${SLACK}/admin/channels` && c.method === "PUT")?.body,
        '{"default":"C0","intercom":true}',
      );
      assert.strictEqual(
        hub.calls.find((c) => c.url === `${SLACK}/me` && c.method === "PUT")?.body,
        '{"enabled":true}',
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
