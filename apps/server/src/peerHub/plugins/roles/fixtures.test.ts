// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off - the broker's log in a temporary checkout, and the bodies the Hub was sent.
/**
 * What this plugin's tests share: a Hub of acme that serves `roles` and keeps the rows it is sent
 * (PUT, PATCH, DELETE) as the design's routes do, a Peer signed in to it as Bob with the plugin
 * started, and a broker in a checkout of the `app` project that runs the plugin's hooks and
 * commands. Bob's agent is `claude:one` on VL-7.
 */
import * as NodeFSP from "node:fs/promises";

import { assert, it } from "@effect/vitest";
import {
  PEER_ROLES_METHODS,
  RolesRpcGroup,
  type PeerHubStatus,
  type PeerRoleRow,
  type PeerTask,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as RpcTest from "effect/rpc/RpcTest";

import * as PeerHub from "../../PeerHub.ts";
import { brokerFixture, pluginsOf } from "../../core/broker/testkit.ts";
import type { PeerBrokerHost } from "../../core/broker/host.ts";
import * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import type { PeerPluginEntry, PeerRpcWrap } from "../../core/plugin.ts";
import * as PeerPlugins from "../../core/plugins/PeerPlugins.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import {
  coreLayer,
  coreRpcStandIns,
  meAnswer,
  seedState,
  standInHub,
  TEST_ENVIRONMENT,
  type HubAnswer,
  type HubCall,
} from "../../core/testkit.ts";
import { RolesPlugin } from "./index.ts";

export const BOB = "bob@acme.test";
export const EVA = "eva@acme.test";
export const ACME = "/v1/workspaces/acme";
export const ROLES = `${ACME}/roles/app`;
const EVENTS = `${ACME}/events`;
export const NOW = "2026-10-27T10:00:00.000Z";

/** `peer-hub.json` of Bob signed in to `hubUrl`, a member of acme's `app` project. */
const seed = (hubUrl: string) =>
  JSON.stringify({
    hubUrl,
    email: BOB,
    pendingSignIn: null,
    workspaces: [
      {
        slug: "acme",
        name: "Acme",
        role: "member",
        allowedDomains: [],
        manifest: {
          version: 2,
          workspace: { slug: "acme", name: "Acme", currency: "EUR" },
          member: { email: BOB, name: "Bob", role: "member" },
          knowledge: {},
          projects: [
            {
              id: "app",
              name: "Ordering demo",
              role: "member",
              members: [
                { email: BOB, name: "Bob" },
                { email: EVA, name: "Eva" },
              ],
              repositories: [{ id: "api", url: "https://github.com/acme/api.git", branch: "main" }],
              knowledge: { kontext: false, company: false },
              tools: [],
              capacity: { personal: "any", personalHarnesses: [] },
            },
          ],
        },
        lastSyncAt: null,
      },
    ],
    joinable: [],
    lastSyncAt: null,
    sharedInstances: {},
  });

export const TASKS: ReadonlyArray<PeerTask> = [
  {
    id: "vl-7",
    key: "VL-7",
    title: "Order totals",
    status: "review",
    createdBy: BOB,
    createdAt: NOW,
    updatedAt: NOW,
  },
];

const COORDINATION: PeerHubStatus["coordination"] = {
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

/** What a test makes its Hub answer to a method and path; undefined leaves it the usual answer. */
export type Route = (method: string, url: string) => readonly [number, unknown] | undefined;

/**
 * The Hub's state: its rows, and what a test adds. A PUT keeps a row, a PATCH marks it, a DELETE
 * drops it; `features` is what `/v1/me` lists.
 */
export interface AcmeHub {
  rows: Array<PeerRoleRow>;
  route?: Route;
  features: Readonly<Record<string, number>>;
}

export const acmeHubOf = (): AcmeHub => ({ rows: [], features: { roles: 1 } });

/** The stand-in Hub's answer, by the request's method, path and body. */
const answerOf =
  (current: AcmeHub, last: { method: string; body: string }): HubAnswer =>
  (url) => {
    const { method, body } = last;
    const routed = current.route?.(method, url);
    if (routed !== undefined) return routed;
    if (url === "/v1/me") return [200, meAnswer(current.features)];
    if (url === EVENTS) return { events: ":\n\n", open: true };
    if (url === ROLES) return [200, { roles: current.rows }];
    if (url.startsWith(`${ROLES}/`)) {
      const session = decodeURIComponent(url.slice(ROLES.length + 1));
      const others = current.rows.filter((row) => row.session !== session);
      if (method === "PUT") {
        const sent = JSON.parse(body) as { role: string; environment: string; setBy: string };
        current.rows = [...others, { session, email: BOB, at: NOW, ...sent }];
      } else if (method === "PATCH") {
        const sent = JSON.parse(body) as { changed: boolean };
        current.rows = current.rows.map((row) =>
          row.session === session ? { ...row, changedFiles: sent.changed } : row,
        );
      } else if (method === "DELETE") current.rows = others;
      return [200, { ok: true }];
    }
    return [404, { error: { code: "not_found", message: "Not here." } }];
  };

/** A stand-in Hub of acme serving `current`; it answers by path, and reads the method and body it was sent. */
export const acmeHub = (current: AcmeHub) =>
  Effect.gen(function* () {
    const sent: { calls: ReadonlyArray<HubCall> } = { calls: [] };
    const answer: HubAnswer = (url) => {
      const call = sent.calls.at(-1);
      return answerOf(current, { method: call?.method ?? "GET", body: call?.body ?? "" })(url);
    };
    const server = yield* standInHub({ current: answer });
    sent.calls = server.calls;
    return server;
  });

/** Peer signed in as Bob to `server`, with `plugin` started, the Hub's catalog read and VL-7 known. */
export const rolesPeer = (
  server: { readonly url: string },
  plugin: PeerPluginEntry = RolesPlugin,
) =>
  Effect.gen(function* () {
    const core = yield* Layer.build(
      coreLayer(yield* seedState(seed(server.url)), { session: "phs_test", plugins: [plugin] }),
    );
    return yield* Effect.gen(function* () {
      const status = yield* PeerStatus.PeerStatus;
      yield* status.coordinationFrom(() => Effect.succeed(COORDINATION));
      const state = yield* PeerState.PeerState;
      yield* state.updateRuntime((runtime) => ({
        ...runtime,
        work: new Map([["acme/app", { areas: [], tasks: TASKS, threads: [] }]]),
      }));
      const client = yield* PeerHubClient.PeerHubClient;
      yield* client.me;
      yield* PeerPlugins.startPlugins;
      return {
        status,
        client,
        state,
        agents: yield* PeerAgents.PeerAgents,
        plugins: yield* PeerPlugins.PeerPlugins,
      };
    }).pipe(Effect.provide(core));
  });

/** A broker in the project's checkout, run by `peer`'s plugins and attached to its agents service. */
export const brokerOver = (
  peer: Effect.Success<ReturnType<typeof rolesPeer>>,
  more: (host: PeerBrokerHost) => Partial<PeerBrokerHost> = () => ({}),
) =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      const fixture = yield* Effect.promise(() =>
        brokerFixture((host) => ({
          ...pluginsOf(peer.plugins),
          environment: TEST_ENVIRONMENT,
          email: () => BOB,
          nameOf: (_workspace, who) => (who === BOB ? "Bob" : who),
          taskOf: () => "vl-7",
          ...more(host),
        })),
      );
      yield* peer.agents.attach(fixture.broker);
      return fixture;
    }),
    (fixture) => Effect.promise(() => fixture.dispose()),
  );

const wrap: PeerRpcWrap = { effect: (_, effect) => effect, stream: (_, stream) => stream };

/** A client of the plugin's RPC methods, as the apps call them. */
export const rpcOver = (plugins: PeerPlugins.PeerPlugins["Service"]) =>
  RpcTest.makeClient(RolesRpcGroup).pipe(
    Effect.provide(
      PeerHub.rpcLayer(wrap).pipe(
        Layer.provide(
          Layer.mergeAll(coreRpcStandIns, Layer.succeed(PeerPlugins.PeerPlugins, plugins)),
        ),
      ),
    ),
  );

/** The first status, now or later, whose roles satisfy `seen`. */
export const rolesWhen = (
  status: PeerStatus.PeerStatus["Service"],
  seen: (roles: PeerHubStatus["roles"]) => boolean,
) =>
  status.changes.pipe(
    Stream.map((next) => next.roles),
    Stream.filter(seen),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  );

/** A Hub serving `current`, Peer signed in to it with the rows read once, and a broker over it. */
export const ready = (
  current: AcmeHub = acmeHubOf(),
  more?: (host: PeerBrokerHost) => Partial<PeerBrokerHost>,
) =>
  Effect.gen(function* () {
    const server = yield* acmeHub(current);
    const peer = yield* rolesPeer(server);
    yield* rolesWhen(peer.status, (roles) => (roles?.projects.length ?? 0) > 0);
    const fixture = yield* brokerOver(peer, more);
    const rpc = yield* rpcOver(peer.plugins);
    /** Reads the Hub's rows now, as an app asking for them does. */
    const reread = rpc[PEER_ROLES_METHODS.peerRolesList]({ workspace: "acme", project: "app" });
    return { server, peer, fixture, rpc, reread, current };
  });

/** The events the broker logged so far, with their raw fields. */
export const logged = async (fixture: Awaited<ReturnType<typeof brokerFixture>>) => {
  await fixture.broker.host.log.idle();
  const text = await NodeFSP.readFile(fixture.debugPath, "utf8").catch(() => "");
  return text
    .trim()
    .split("\n")
    .filter((line) => line !== "")
    .map(
      (line) => JSON.parse(line) as { readonly event: string; readonly [field: string]: unknown },
    );
};

it("keeps a role the Hub was sent and drops it when cleared", () => {
  const current = acmeHubOf();
  const last = {
    method: "PUT",
    body: JSON.stringify({ role: "review", environment: "e", setBy: "agent" }),
  };
  answerOf(current, last)(`${ROLES}/claude%3Aone`);
  assert.deepStrictEqual(
    current.rows.map((row) => [row.session, row.setBy]),
    [["claude:one", "agent"]],
  );
  last.method = "DELETE";
  answerOf(current, last)(`${ROLES}/claude%3Aone`);
  assert.deepStrictEqual(current.rows, []);
});
