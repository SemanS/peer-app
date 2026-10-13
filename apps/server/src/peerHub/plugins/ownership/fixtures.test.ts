// @effect-diagnostics nodeBuiltinImport:off globalDate:off - the broker's log in a temporary checkout, and a call that expires a week from now.
/**
 * What this plugin's tests share: acme's `app` project as the Hub's ownership view tells it, a Peer
 * signed in to a stand-in Hub that serves that view with the plugin started, and a broker in a
 * checkout of the project that runs the plugin's hooks and commands. Bob's agent (the person this
 * Peer is signed in as) works on ORD-9; Ana owns `src/payments/**`, where she decides, as in the
 * design canvas. It holds the module's one test of its own, that the view decodes, because a file that
 * is not a test counts against the plugin's line budget.
 */
import * as NodeFSP from "node:fs/promises";

import { assert, it } from "@effect/vitest";
import {
  OwnershipRpcGroup,
  PEER_OWNERSHIP_METHODS,
  PeerOwnershipView,
  type PeerHubStatus,
  type PeerOwnerCall,
  type PeerOwnershipProjectView,
  type PeerTask,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as RpcTest from "effect/unstable/rpc/RpcTest";

import * as PeerHub from "../../PeerHub.ts";
import { brokerFixture, pluginsOf } from "../../core/broker/testkit.ts";
import type { PeerBrokerHost } from "../../core/broker/host.ts";
import * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import * as PeerHubEvents from "../../core/hub/PeerHubEvents.ts";
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
} from "../../core/testkit.ts";
import { OwnershipPlugin } from "./index.ts";

export const ANA = "ana@acme.test";
export const BOB = "bob@acme.test";
export const CYRIL = "cyril@acme.test";
export const EVA = "eva@acme.test";
export const NAMES: Readonly<Record<string, string>> = {
  [ANA]: "Ana",
  [BOB]: "Bob",
  [CYRIL]: "Cyril",
  [EVA]: "Eva",
};

export const ACME = "/v1/workspaces/acme";
export const VIEW = `${ACME}/ownership`;
export const EVENTS = `${ACME}/events`;
export const CALLS = `${ACME}/projects/app/owner-calls`;
export const NOW = "2026-10-12T10:00:00.000Z";
/** A week from now: where a call opened now expires, whenever the test runs. */
export const SOON = new Date(Date.now() + 7 * 86_400_000).toISOString();

/** Bob's agent's call to Ana for ORD-9, which waits unless `over` says otherwise. */
export const callOf = (over: Partial<PeerOwnerCall> = {}): PeerOwnerCall => ({
  id: "oc-7f2a",
  project: "app",
  task: "ord-9",
  session: "claude:one",
  email: BOB,
  environment: TEST_ENVIRONMENT,
  owner: ANA,
  paths: ["src/payments/fees.ts"],
  reason: "add a refund fee field for ORD-9",
  state: "pending",
  onBehalf: false,
  createdAt: NOW,
  updatedAt: NOW,
  expiresAt: SOON,
  ...over,
});

/** The app project: Ana owns `src/payments/**` and decides there, Cyril `src/menu/**`; Eva leads. */
export const projectOf = (
  over: Partial<PeerOwnershipProjectView> = {},
): PeerOwnershipProjectView => ({
  leads: [EVA],
  map: {
    version: 7,
    areas: { Payments: ANA },
    paths: { "src/payments/**": ANA, "src/menu/**": CYRIL },
    decide: ["src/payments/**"],
  },
  tasks: {},
  calls: [],
  ...over,
});

export const viewOf = (
  project: PeerOwnershipProjectView = projectOf(),
  at = NOW,
): PeerOwnershipView => ({ projects: { app: project }, at });

/** `peer-hub.json` of `email` signed in to `hubUrl`, a member of acme's Ordering demo (`app`). */
export const ownershipSeed = (hubUrl: string, email: string = BOB) =>
  JSON.stringify({
    hubUrl,
    email,
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
          member: { email, name: NAMES[email] ?? email, role: "member" },
          knowledge: {},
          projects: [
            {
              id: "app",
              name: "Ordering demo",
              role: "member",
              members: [ANA, BOB, CYRIL, EVA].map((member) => ({
                email: member,
                name: NAMES[member],
              })),
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

/** What a test makes its Hub answer to a path: an answer, or nothing, which leaves it the usual one. */
export type Route = (url: string) => ReturnType<HubAnswer> | undefined;

/**
 * A Hub of acme that serves ownership: `current.view` is what it says, `current.route` answers what
 * the test adds (a call asked, decided, a map saved), and the event stream stays open.
 */
export const acmeHub =
  (current: { view: PeerOwnershipView; route?: Route }): HubAnswer =>
  (url) =>
    current.route?.(url) ??
    (url === "/v1/me"
      ? [200, meAnswer({ ownership: 1 })]
      : url === EVENTS
        ? { events: ":\n\n", open: true }
        : url.startsWith(VIEW)
          ? [200, current.view]
          : [404, { error: { code: "not_found", message: "Not here." } }]);

export const COORDINATION: PeerHubStatus["coordination"] = {
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

/** The tasks of the app project as the Hub's work names them. */
export const TASKS: ReadonlyArray<PeerTask> = [
  {
    id: "ord-9",
    key: "ORD-9",
    title: "Refund fee field",
    area: "Payments",
    status: "open",
    createdBy: BOB,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: "ord-11",
    key: "ORD-11",
    title: "Receipt totals in cents",
    area: "Payments",
    status: "open",
    createdBy: ANA,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: "ord-12",
    key: "ORD-12",
    title: "Menu notes field",
    area: "Menu",
    status: "open",
    createdBy: CYRIL,
    createdAt: NOW,
    updatedAt: NOW,
  },
];

/**
 * Peer signed in as `email` to `hub`, with `plugin` (the ownership plugin) started, the Hub's answer
 * read and the app project's tasks known.
 */
export const ownershipPeer = (
  hub: { readonly url: string },
  email: string = BOB,
  plugin: PeerPluginEntry = OwnershipPlugin,
) =>
  Effect.gen(function* () {
    const core = yield* Layer.build(
      coreLayer(yield* seedState(ownershipSeed(hub.url, email)), {
        session: "phs_test",
        plugins: [plugin],
      }),
    );
    return yield* Effect.gen(function* () {
      const status = yield* PeerStatus.PeerStatus;
      yield* status.coordinationFrom(() => Effect.succeed(COORDINATION));
      const state = yield* PeerState.PeerState;
      yield* state.updateRuntime((runtime) => ({
        ...runtime,
        work: new Map([["acme/app", { areas: ["Payments"], tasks: TASKS, threads: [] }]]),
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
        events: yield* PeerHubEvents.PeerHubEvents,
      };
    }).pipe(Effect.provide(core));
  });

/**
 * A broker in the project's checkout, run by `peer`'s plugins and attached to its agents service as
 * coordination attaches its own: Bob's sessions on ORD-9, the people named as the workspace names them.
 */
export const brokerOver = (
  peer: Effect.Success<ReturnType<typeof ownershipPeer>>,
  more: (host: PeerBrokerHost) => Partial<PeerBrokerHost> = () => ({}),
  email: string = BOB,
) =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      const fixture = yield* Effect.promise(() =>
        brokerFixture((host) => ({
          ...pluginsOf(peer.plugins),
          environment: TEST_ENVIRONMENT,
          email: () => email,
          nameOf: (_workspace, who) => NAMES[who] ?? who,
          taskOf: () => "ord-9",
          taskName: (_workspace, _project, task) =>
            task === "ord-9" ? "ORD-9 · Refund fee field" : task,
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
  RpcTest.makeClient(OwnershipRpcGroup).pipe(
    Effect.provide(
      PeerHub.rpcLayer(wrap).pipe(
        Layer.provide(
          Layer.mergeAll(coreRpcStandIns, Layer.succeed(PeerPlugins.PeerPlugins, plugins)),
        ),
      ),
    ),
  );

/** The first status, now or later, whose ownership satisfies `seen`. */
export const ownershipWhen = (
  status: PeerStatus.PeerStatus["Service"],
  seen: (ownership: PeerHubStatus["ownership"]) => boolean,
) =>
  status.changes.pipe(
    Stream.map((next) => next.ownership),
    Stream.filter(seen),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  );
export const hasProject = (ownership: PeerHubStatus["ownership"]) =>
  (ownership?.projects.length ?? 0) > 0;

/**
 * A Hub serving `current`, Peer signed in to it as `email` with the Hub's view read, and a broker
 * over that Peer (see `brokerOver`).
 */
export const ready = (
  current: { view: PeerOwnershipView; route?: Route },
  email: string = BOB,
  more?: (host: PeerBrokerHost) => Partial<PeerBrokerHost>,
) =>
  Effect.gen(function* () {
    const hub = yield* standInHub({ current: acmeHub(current) });
    const peer = yield* ownershipPeer(hub, email);
    yield* ownershipWhen(peer.status, hasProject);
    const fixture = yield* brokerOver(peer, more, email);
    /** Reads the Hub's view now, as an app asking for it does. */
    const reread = rpcOver(peer.plugins).pipe(
      Effect.flatMap((rpc) => rpc[PEER_OWNERSHIP_METHODS.peerOwnershipList]({ workspace: "acme" })),
      Effect.asVoid,
    );
    return { hub, peer, fixture, reread };
  });

/** The events the broker logged so far, with their raw fields. */
export const logged = async (fixture: Awaited<ReturnType<typeof brokerFixture>>) => {
  await fixture.broker.host.log.idle();
  // Nothing is logged until something is: no file is no event.
  const text = await NodeFSP.readFile(fixture.debugPath, "utf8").catch(() => "");
  return text
    .trim()
    .split("\n")
    .filter((line) => line !== "")
    .map(
      (line) => JSON.parse(line) as { readonly event: string; readonly [field: string]: unknown },
    );
};

const decodeView = Schema.decodeUnknownSync(PeerOwnershipView);

it("keeps a view the way the Hub's wire contract reads it", () => {
  const decoded = decodeView(viewOf(projectOf({ calls: [callOf()], tasks: {} })));
  assert.deepStrictEqual(Object.keys(decoded.projects), ["app"]);
  assert.strictEqual(decoded.projects.app?.calls[0]?.owner, ANA);
});
