// @effect-diagnostics nodeBuiltinImport:off globalDate:off - the broker's log in a temporary checkout, and agreements settled days before the test runs.
/**
 * What this plugin's tests share: acme's `app` project, in which the agents of KRK-1 (Ana's) and
 * KRK-2 (Bob's) settled an overlap; a Peer signed in to a stand-in Hub that serves the agreements
 * of that project, with the plugin started; and a broker in a checkout of the project that runs the
 * plugin's hooks and commands. Ana's earlier session on KRK-1 and Bob's agent on KRK-2 are the sides
 * of the agreement; the session of the person this Peer is signed in as, on the task `taskOf` says
 * (KRK-1 by default), is a later one that took no part. It holds the module's one test of its own,
 * that the Hub's view decodes, because a file that is not a test counts against the plugin's
 * line budget.
 */
import * as NodeFSP from "node:fs/promises";

import { assert, it } from "@effect/vitest";
import {
  AgreementsRpcGroup,
  PEER_AGREEMENTS_METHODS,
  PeerAgreementsView,
  type EnvironmentAuthorizationError,
  type PeerAgreement,
  type PeerHubError,
  type PeerHubStatus,
  type PeerTask,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
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
import { AgreementsPlugin } from "./index.ts";

export const ANA = "ana@acme.test";
export const BOB = "bob@acme.test";
export const CYRIL = "cyril@acme.test";
export const NAMES: Readonly<Record<string, string>> = {
  [ANA]: "Ana",
  [BOB]: "Bob",
  [CYRIL]: "Cyril",
};

export const ACME = "/v1/workspaces/acme";
export const VIEW = `${ACME}/agreements`;
export const EVENTS = `${ACME}/events`;
export const DAY = 86_400_000;
/** When something happened `ms` before the test runs: the plugin tells time by the real clock here. */
export const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

export const WORDS = "Loyalty keeps euros; src/loyalty.js divides by 100 once KRK-1 lands";

/**
 * The agreement of KRK-1 and KRK-2, settled three days ago by Bob's agent on KRK-2 with Ana's
 * session `claude:old` on KRK-1, and open unless `over` says otherwise.
 */
export const agreementOf = (over: Partial<PeerAgreement> = {}): PeerAgreement => ({
  id: "3f9a0c1b2d4e5f60",
  project: "app",
  tasks: ["krk-1", "krk-2"],
  words: WORDS,
  by: { email: BOB, task: "krk-2" },
  settledAt: ago(3 * DAY),
  sides: [
    { session: "claude:old", environment: TEST_ENVIRONMENT, email: ANA, task: "krk-1" },
    { session: "claude:bob", environment: "bob-laptop", email: BOB, task: "krk-2" },
  ],
  state: "open",
  landed: [],
  ...over,
});

/** The agreement as it reads once KRK-1 landed: due for KRK-2. */
export const dueOf = (over: Partial<PeerAgreement> = {}) =>
  agreementOf({ state: "due", dueFor: "krk-2", landed: ["krk-1"], ...over });

/** The agreement as it reads once a person closed it. */
export const closedOf = (over: Partial<PeerAgreement> = {}) =>
  agreementOf({
    state: "closed",
    closed: { at: ago(DAY), by: ANA, why: "handled" },
    ...over,
  });

export const viewOf = (
  agreements: ReadonlyArray<PeerAgreement> = [agreementOf()],
  at = "2026-10-13T12:00:00.000Z",
): PeerAgreementsView => ({ agreements, at });

/** `peer-hub.json` of `email` signed in to `hubUrl`, a member of acme's Ordering demo (`app`). */
export const agreementsSeed = (hubUrl: string, email: string = ANA) =>
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
              members: [ANA, BOB, CYRIL].map((member) => ({
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
 * A Hub of acme that serves agreements: `current.view` is what it says (a project's agreements for
 * a read that names the project), `current.route` answers what the test adds (a close, a failure),
 * and the event stream stays open.
 */
export const acmeHub =
  (current: { view: PeerAgreementsView; route?: Route }): HubAnswer =>
  (url) =>
    current.route?.(url) ??
    (url === "/v1/me"
      ? [200, meAnswer({ agreements: 1 })]
      : url === EVENTS
        ? { events: ":\n\n", open: true }
        : url === VIEW
          ? [200, current.view]
          : url.startsWith(`${VIEW}?project=`)
            ? [
                200,
                {
                  ...current.view,
                  agreements: current.view.agreements.filter(
                    (agreement) =>
                      agreement.project ===
                      decodeURIComponent(url.slice(`${VIEW}?project=`.length)),
                  ),
                },
              ]
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

const task = (id: string, key: string, title: string, createdBy: string): PeerTask => ({
  id,
  key,
  title,
  status: "open",
  createdBy,
  createdAt: "2026-10-12T10:00:00.000Z",
  updatedAt: "2026-10-12T10:00:00.000Z",
});

/** The tasks of the app project as the Hub's work names them. */
export const TASKS: ReadonlyArray<PeerTask> = [
  task("krk-1", "KRK-1", "Rounding of totals", ANA),
  task("krk-2", "KRK-2", "Loyalty points", BOB),
  task("krk-3", "KRK-3", "Receipt layout", CYRIL),
  task("krk-4", "KRK-4", "Gift cards", CYRIL),
];

/**
 * Peer signed in as `email` to `hub`, with `plugin` (the agreements plugin) started, the Hub's
 * answer read and the app project's tasks known.
 */
export const agreementsPeer = (
  hub: { readonly url: string },
  email: string = ANA,
  plugin: PeerPluginEntry = AgreementsPlugin,
) =>
  Effect.gen(function* () {
    const core = yield* Layer.build(
      coreLayer(yield* seedState(agreementsSeed(hub.url, email)), {
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
        events: yield* PeerHubEvents.PeerHubEvents,
      };
    }).pipe(Effect.provide(core));
  });

/**
 * A broker in the project's checkout, run by `peer`'s plugins and attached to its agents service as
 * coordination attaches its own: the sessions of `email` are on KRK-1, and the people are named as
 * the workspace names them.
 */
export const brokerOver = (
  peer: Effect.Success<ReturnType<typeof agreementsPeer>>,
  more: (host: PeerBrokerHost) => Partial<PeerBrokerHost> = () => ({}),
  email: string = ANA,
) =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      const fixture = yield* Effect.promise(() =>
        brokerFixture((host) => ({
          ...pluginsOf(peer.plugins),
          environment: TEST_ENVIRONMENT,
          email: () => email,
          nameOf: (_workspace, who) => NAMES[who] ?? who,
          taskOf: () => "krk-1",
          taskName: (_workspace, _project, id) =>
            TASKS.find((candidate) => candidate.id === id)?.key ?? id,
          ...more(host),
        })),
      );
      yield* peer.agents.attach(fixture.broker);
      return fixture;
    }),
    (fixture) => Effect.promise(() => fixture.dispose()),
  );

/** What an RPC call that failed was refused with: the Hub's error, as the app reads it. */
export const refusedWith = <A>(
  call: Effect.Effect<A, EnvironmentAuthorizationError | PeerHubError>,
): Effect.Effect<PeerHubError> =>
  call.pipe(
    Effect.result,
    Effect.flatMap((result) =>
      Result.isFailure(result) && result.failure._tag === "PeerHubError"
        ? Effect.succeed(result.failure)
        : Effect.die("the call was not refused by the Hub"),
    ),
  );

const wrap: PeerRpcWrap = { effect: (_, effect) => effect, stream: (_, stream) => stream };

/** A client of the plugin's RPC methods, as the apps call them. */
export const rpcOver = (plugins: PeerPlugins.PeerPlugins["Service"]) =>
  RpcTest.makeClient(AgreementsRpcGroup).pipe(
    Effect.provide(
      PeerHub.rpcLayer(wrap).pipe(
        Layer.provide(
          Layer.mergeAll(coreRpcStandIns, Layer.succeed(PeerPlugins.PeerPlugins, plugins)),
        ),
      ),
    ),
  );

/** The first status, now or later, whose agreements satisfy `seen`. */
export const agreementsWhen = (
  status: PeerStatus.PeerStatus["Service"],
  seen: (agreements: PeerHubStatus["agreements"]) => boolean,
) =>
  status.changes.pipe(
    Stream.map((next) => next.agreements),
    Stream.filter(seen),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  );
export const hasWorkspace = (agreements: PeerHubStatus["agreements"]) =>
  (agreements?.workspaces.length ?? 0) > 0;

/**
 * A Hub serving `current`, Peer signed in to it as `email` with the Hub's view read, and a broker
 * over that Peer (see `brokerOver`).
 */
export const ready = (
  current: { view: PeerAgreementsView; route?: Route },
  email: string = ANA,
  more?: (host: PeerBrokerHost) => Partial<PeerBrokerHost>,
) =>
  Effect.gen(function* () {
    const hub = yield* standInHub({ current: acmeHub(current) });
    const peer = yield* agreementsPeer(hub, email);
    yield* agreementsWhen(peer.status, hasWorkspace);
    const fixture = yield* brokerOver(peer, more, email);
    /** Reads the Hub's agreements now, as an app asking for them does. */
    const reread = rpcOver(peer.plugins).pipe(
      Effect.flatMap((rpc) =>
        rpc[PEER_AGREEMENTS_METHODS.peerAgreementsView]({ workspace: "acme" }),
      ),
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

/** The log Peer keeps: the events the metrics catalog allows, by their counts and classes. */
export const kept = async (fixture: Awaited<ReturnType<typeof brokerFixture>>) => {
  await fixture.broker.host.log.idle();
  const text = await NodeFSP.readFile(fixture.broker.host.logPath, "utf8").catch(() => "");
  return text
    .trim()
    .split("\n")
    .filter((line) => line !== "")
    .map(
      (line) => JSON.parse(line) as { readonly event: string; readonly [field: string]: unknown },
    );
};

/** The lines of `event` in a log, without the time they were written at. */
export const lineOf = (
  lines: ReadonlyArray<{ readonly event: string; readonly [field: string]: unknown }>,
  event: string,
) =>
  lines
    .filter((line) => line.event === event)
    .map((line) => Object.fromEntries(Object.entries(line).filter(([field]) => field !== "t")));

/**
 * The hooks of the session `id` in the broker's checkout, as its agent's harness runs them, and what
 * each adds to its context: `start` its session start (`source` startup, resume or compact), `step` an
 * ordinary step (a shell command that has run), `shell` the step before a command, whose denial it
 * reads. `headers` says which agent it is (Codex's `x-peer-agent`).
 */
export const hooks = (
  fixture: Awaited<ReturnType<typeof brokerFixture>>,
  id = "one",
  headers: Record<string, string> = {},
) => {
  const body = (event: string, more: Record<string, unknown> = {}) => ({
    hook_event_name: event,
    session_id: id,
    cwd: fixture.root,
    ...more,
  });
  const added = async (event: string, more: Record<string, unknown> = {}) =>
    ((
      (await fixture.broker["hook"](body(event, more), headers))?.hookSpecificOutput as
        | { readonly additionalContext?: string }
        | undefined
    )?.additionalContext ?? "") as string;
  return {
    start: (source = "startup") => added("SessionStart", { source }),
    step: () => added("PostToolUse", { tool_name: "Bash", tool_input: { command: "ls" } }),
    shell: async (command: string) =>
      ((
        await fixture.broker["hook"](
          body("PreToolUse", { tool_name: "Bash", tool_input: { command } }),
          headers,
        )
      )?.hookSpecificOutput as
        | { readonly permissionDecision?: string; readonly permissionDecisionReason?: string }
        | undefined) ?? {},
  };
};

const decodeView = Schema.decodeUnknownSync(PeerAgreementsView);

it("keeps a view the way the Hub's wire contract reads it", () => {
  const decoded = decodeView(
    viewOf([agreementOf(), dueOf({ id: "0a1b2c3d4e5f6071" }), closedOf()]),
  );
  assert.deepStrictEqual(
    decoded.agreements.map((agreement) => agreement.state),
    ["open", "due", "closed"],
  );
  assert.strictEqual(decoded.agreements[0]?.sides[0]?.session, "claude:old");
});
