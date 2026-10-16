import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, expect, it } from "@effect/vitest";
import {
  PEER_SLACK_METHODS as m,
  PeerHubError,
  SlackRpcGroup,
  type PeerHubStatus,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as RpcTest from "effect/rpc/RpcTest";

import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import type { PeerRpcWrap } from "../../core/plugin.ts";
import * as PeerPlugins from "../../core/plugins/PeerPlugins.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import {
  coreLayer,
  coreRpcStandIns,
  meAnswer,
  paymentsSeed,
  seedState,
  standInHub,
  type HubAnswer,
} from "../../core/testkit.ts";
import * as PeerHub from "../../PeerHub.ts";
import { SlackPlugin } from "./index.ts";
import { slackLedger } from "./ledger.ts";

it("is the Slack plugin, served by the Hub's slack feature and on by default", () => {
  expect(SlackPlugin.id).toBe("slack");
  expect(SlackPlugin.hubFeature).toEqual({ id: "slack", revision: 1 });
  expect(SlackPlugin.defaultEnabled).toBe(true);
});

const coordination: PeerHubStatus["coordination"] = {
  enabled: false,
  policy: "coordinate",
  claudeHooks: false,
  logPath: "/tmp/coordination.jsonl",
  sessions: [],
  overlaps: [],
  findings: [],
  contexts: [],
  candidates: [],
};

const WORKSPACE = "/v1/workspaces/acme";
const ME = `${WORKSPACE}/slack/me`;
const ADMIN = `${WORKSPACE}/slack/admin`;
const WITHDRAW = `${WORKSPACE}/slack/asks/withdraw`;

/** What `GET /slack/me` says of Ana: linked, on, and not to be kept waiting. */
const mine = {
  connected: true,
  team: { id: "T1", name: "Acme" },
  bot: { name: "Peer" },
  link: { slackUser: "U1", name: "ana", linkedAt: "2026-10-10T08:00:00Z" },
  pending: null,
  settings: { enabled: false, delayMinutes: 5, place: "thread", kinds: ["approval"] },
  projects: [{ id: "pay", name: "Payments", mode: "thread" }],
};
const admin = {
  state: "connected",
  secrets: { botToken: "stored", signingSecret: "stored" },
  team: { id: "T1", name: "Acme" },
  bot: { user: "U9", app: "A1", name: "Peer" },
  verifiedAt: "2026-10-10T08:00:00Z",
  auth: null,
  default: { id: "C0", name: "peer", private: false },
  projects: [],
  lastPostAt: null,
  lastFailure: null,
  linkedMembers: 1,
  openAsks: 0,
};
const error = (status: number, code: string, message: string) =>
  [status, { error: { code, message } }] as const;

/**
 * Peer on a Hub that serves Slack (or not yet, with `served: false`). What the Hub answers a
 * `METHOD path` with is `script`; the rest is a plain answer. Slack's own loop is not under test
 * here, so Ana has Slack off and nothing is waiting.
 */
const started = (served: boolean) =>
  Effect.gen(function* () {
    const script = new Map<string, readonly [number, unknown]>();
    const answer: { current: HubAnswer } = {
      current: (url) => {
        const path = url.split("?")[0] ?? url;
        const scripted = script.get(`${hub.calls.at(-1)?.method ?? "GET"} ${path}`);
        if (scripted !== undefined) return scripted;
        if (url === "/v1/me") return [200, meAnswer(served ? { slack: 1 } : undefined)];
        if (path === ME) return [200, mine];
        if (path === ADMIN) return [200, admin];
        if (path === WITHDRAW) return [200, { ask: "a_1", state: "withdrawn" }];
        return [200, {}];
      },
    };
    const hub = yield* standInHub(answer);
    const core = yield* Layer.build(
      coreLayer(yield* seedState(paymentsSeed(hub.url)), {
        session: "phs_test",
        plugins: [SlackPlugin],
      }),
    );
    const { plugins, client, state } = yield* Effect.gen(function* () {
      yield* (yield* PeerStatus.PeerStatus).coordinationFrom(() => Effect.succeed(coordination));
      yield* PeerPlugins.startPlugins;
      return {
        plugins: yield* PeerPlugins.PeerPlugins,
        client: yield* PeerHubClient.PeerHubClient,
        state: yield* PeerState.PeerState,
      };
    }).pipe(Effect.provide(core));
    const wrap: PeerRpcWrap = {
      effect: (_method, effect) => effect,
      stream: (_method, stream) => stream,
    };
    /** The plugin's methods, as a client of the Peer RPC server calls them. */
    const rpc = RpcTest.makeClient(SlackRpcGroup).pipe(
      Effect.provide(
        PeerHub.rpcLayer(wrap).pipe(
          Layer.provide(
            Layer.mergeAll(coreRpcStandIns, Layer.succeed(PeerPlugins.PeerPlugins, plugins)),
          ),
        ),
      ),
    );
    const sent = (url: string) =>
      hub.calls.filter((call) => call.url?.split("?")[0] === url).map((call) => call.body);
    return { hub, script, plugins, client, rpc, sent, ledger: slackLedger(state) };
  });

const isHubError = Schema.is(PeerHubError);
/** The Peer error an RPC call failed with, if it did. */
const refusal = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.result,
    Effect.map((result) =>
      Result.isFailure(result) && isHubError(result.failure) ? result.failure : undefined,
    ),
  );

describe("the Slack plugin", () => {
  it.effect(
    "serves its methods with the addresses Slack calls, and says what the Hub refuses",
    () =>
      Effect.gen(function* () {
        const s = yield* started(true);
        yield* s.client.me;
        const rpc = yield* s.rpc;
        const view = yield* rpc[m.peerSlackAdmin]({ workspace: "acme" });
        assert.strictEqual(view.hubUrl, s.hub.url);
        assert.deepStrictEqual(view.manifest, {
          eventsUrl: `${s.hub.url}/v1/workspaces/acme/slack/events`,
          actionsUrl: `${s.hub.url}/v1/workspaces/acme/slack/actions`,
        });
        assert.strictEqual(view.secrets.botToken, "stored");
        assert.strictEqual((yield* rpc[m.peerSlackMe]({ workspace: "acme" })).link?.name, "ana");

        // The app's two secrets are sealed through the Hub's secrets route, then the view is read.
        yield* rpc[m.peerSlackSaveSecrets]({
          workspace: "acme",
          botToken: "xoxb-1234",
          signingSecret: "sign-5678",
        });
        assert.deepStrictEqual(s.sent(`${WORKSPACE}/secrets/slack-bot-token`), [
          '{"value":"xoxb-1234"}',
        ]);
        assert.deepStrictEqual(s.sent(`${WORKSPACE}/secrets/slack-signing-secret`), [
          '{"value":"sign-5678"}',
        ]);
        assert.strictEqual(s.hub.calls.at(-1)?.url, ADMIN);

        s.script.set(`PUT ${ME}`, error(409, "not_linked", "link your Slack account first"));
        const unlinked = yield* refusal(
          rpc[m.peerSlackSetMine]({ workspace: "acme", enabled: true }),
        );
        assert.strictEqual(unlinked?.code, "not_linked");
        assert.strictEqual(unlinked?.refused, true);
        assert.include(unlinked?.detail ?? "", "link your Slack account");
        s.script.set(
          `POST ${ADMIN}/verify`,
          error(409, "secrets_missing", "store the bot token first"),
        );
        assert.strictEqual(
          (yield* refusal(rpc[m.peerSlackVerify]({ workspace: "acme" })))?.code,
          "secrets_missing",
        );

        // A Hub without the routes says it has no Slack; one that does not know the workspace says so.
        s.script.set(`GET ${ADMIN}`, error(404, "not_found", "no such route"));
        assert.strictEqual(
          (yield* refusal(rpc[m.peerSlackAdmin]({ workspace: "acme" })))?.detail,
          "This Peer Hub has no Slack support yet.",
        );
        s.script.set(`GET ${ADMIN}`, error(404, "not_found", "no such workspace"));
        assert.strictEqual(
          (yield* refusal(rpc[m.peerSlackAdmin]({ workspace: "acme" })))?.detail,
          "no such workspace",
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("serves nothing while the Hub lacks Slack, or the plugin is off", () =>
    Effect.gen(function* () {
      const s = yield* started(false);
      const rpc = yield* s.rpc;
      yield* s.client.me;
      const asking = rpc[m.peerSlackMe]({ workspace: "acme" });
      assert.include((yield* refusal(asking))?.detail ?? "", "needs a newer Peer Hub");
      s.script.set("GET /v1/me", [200, meAnswer({ slack: 1 })]);
      yield* s.client.me;
      assert.strictEqual((yield* asking).connected, true);
      yield* s.plugins.setPlugin({ id: "slack", enabled: false });
      assert.strictEqual(
        (yield* refusal(asking))?.detail,
        "Slack is turned off on this environment.",
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "withdraws what this computer opened when its owner turns Slack off, and says if it cannot",
    () =>
      Effect.gen(function* () {
        const s = yield* started(false);
        const entry = (opened: boolean, closed = false) => ({
          workspace: "acme",
          firstSeenAt: "2026-10-10T12:00:00.000Z",
          opened,
          closed,
          occurrence: 1,
        });
        yield* s.ledger.update((ledger) => ({
          ...ledger,
          waits: {
            "peer:t1:req:r1": entry(true),
            "peer:t2:req:r2": entry(true, true),
            "peer:t3:req:r3": entry(false),
          },
        }));
        s.script.set(`POST ${WITHDRAW}`, error(503, "unavailable", "try again"));
        yield* s.plugins.setPlugin({ id: "slack", enabled: false });
        // The choice stands; what could not be undone shows as the plugin's error.
        const [failed] = yield* s.plugins.states;
        assert.strictEqual(failed?.enabled, false);
        assert.include(failed?.error ?? "", "1 Slack message(s) could not be withdrawn");

        s.script.delete(`POST ${WITHDRAW}`);
        yield* s.plugins.setPlugin({ id: "slack", enabled: true });
        yield* s.plugins.setPlugin({ id: "slack", enabled: false });
        assert.deepStrictEqual(
          s.sent(WITHDRAW).map((body) => JSON.parse(body)),
          [
            { environment: "ana-laptop", waitKey: "peer:t1:req:r1", reason: "off" },
            { environment: "ana-laptop", waitKey: "peer:t1:req:r1", reason: "off" },
          ],
        );
        const { waits } = yield* s.ledger.read;
        // What was opened and told to the Hub is over; a closed one moves on; one never opened is gone.
        assert.strictEqual(waits["peer:t1:req:r1"]?.occurrence, 2);
        assert.strictEqual(waits["peer:t1:req:r1"]?.opened, false);
        assert.strictEqual(waits["peer:t2:req:r2"]?.occurrence, 2);
        assert.isUndefined(waits["peer:t3:req:r3"]);
        const [ok] = yield* s.plugins.states;
        assert.isUndefined(ok?.error);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
