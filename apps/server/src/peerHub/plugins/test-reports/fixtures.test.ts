// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off - the bodies the Hub was sent.
/**
 * What this plugin's tests share: Ana signed in to a stand-in Hub that serves `test-reports` (design
 * D4), with the plugin started and the Payments project's task VL7 known, and a broker in a checkout
 * of the project whose agent `one` works on VL7. It holds the module's one test of its own, because a
 * file that is not a test counts against the plugin's line budget.
 */
import { assert, it } from "@effect/vitest";
import {
  PEER_TEST_REPORTS_METHODS,
  TestReportsRpcGroup,
  type PeerHubStatus,
  type PeerTask,
  type PeerTestReport,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as RpcTest from "effect/rpc/RpcTest";

import * as PeerHub from "../../PeerHub.ts";
import { brokerFixture, pluginsOf } from "../../core/broker/testkit.ts";
import * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import { CliError, render, type PeerRpcWrap } from "../../core/plugin.ts";
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
import { TestReportsPlugin } from "./index.ts";

export const ANA = "ana@acme.test";
export const SLAVO = "slavo@acme.test";
export const TESTS = "/v1/workspaces/acme/tests/pay/vl-7";
const EVENTS = "/v1/workspaces/acme/events";
const NOW = "2026-10-27T14:00:00.000Z";

export const TASKS: ReadonlyArray<PeerTask> = [
  {
    id: "vl-7",
    key: "VL7",
    title: "Task page layout",
    status: "review",
    createdBy: ANA,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: "vl-8",
    key: "VL8",
    title: "Settings",
    status: "open",
    createdBy: ANA,
    createdAt: NOW,
    updatedAt: NOW,
  },
];

/** A report as the Hub stores one, Ana's mixed report 1 on VL7 unless `over` says otherwise. */
export const reportOf = (over: Partial<PeerTestReport> = {}): PeerTestReport => ({
  project: "pay",
  task: "vl-7",
  author: ANA,
  number: 1,
  result: "mixed",
  summary: "Unit tests pass; the phone was not checked",
  items: [
    { kind: "pass", text: "cargo test features::handoff" },
    { kind: "unverified", text: "iPhone layout of the task page", owner: SLAVO },
  ],
  role: "author",
  at: "2026-10-27T14:03:00.000Z",
  ...over,
});

export type Route = (url: string) => ReturnType<HubAnswer> | undefined;

/** A Hub of acme that serves `test-reports` at `revision` (none: not served), and what `route` adds. */
export const acmeHub =
  (current: { route?: Route; revision?: number | null }): HubAnswer =>
  (url) =>
    current.route?.(url) ??
    (url === "/v1/me"
      ? [200, meAnswer(current.revision === null ? {} : { "test-reports": current.revision ?? 1 })]
      : url === EVENTS
        ? { events: ":\n\n", open: true }
        : [404, { error: { code: "not_found", message: "Not here." } }]);

const wrap: PeerRpcWrap = { effect: (_, effect) => effect, stream: (_, stream) => stream };

/** Ana's Peer on `hub`, with the plugin started and VL7 known; a broker over it with agent `one` on VL7. */
export const ready = (current: { route?: Route; revision?: number | null }) =>
  Effect.gen(function* () {
    const hub = yield* standInHub({ current: acmeHub(current) });
    const core = yield* Layer.build(
      coreLayer(yield* seedState(paymentsSeed(hub.url)), {
        session: "phs_test",
        plugins: [TestReportsPlugin],
      }),
    );
    const peer = yield* Effect.gen(function* () {
      const status = yield* PeerStatus.PeerStatus;
      yield* status.coordinationFrom(() =>
        Effect.succeed({
          enabled: false,
          policy: "coordinate",
          claudeHooks: false,
          logPath: "",
          sessions: [],
          overlaps: [],
          findings: [],
          contexts: [],
          candidates: [],
        } satisfies PeerHubStatus["coordination"]),
      );
      const state = yield* PeerState.PeerState;
      yield* state.updateRuntime((runtime) => ({
        ...runtime,
        work: new Map([["acme/pay", { areas: [], tasks: TASKS, threads: [] }]]),
      }));
      yield* (yield* PeerHubClient.PeerHubClient).me;
      yield* PeerPlugins.startPlugins;
      return {
        status,
        agents: yield* PeerAgents.PeerAgents,
        plugins: yield* PeerPlugins.PeerPlugins,
      };
    }).pipe(Effect.provide(core));
    const fixture = yield* Effect.acquireRelease(
      Effect.promise(() =>
        brokerFixture((host) => ({
          ...pluginsOf(peer.plugins),
          placeOf: async (cwd) => {
            const place = await host.placeOf(cwd);
            return place === null ? null : { ...place, project: "pay" };
          },
          nameOf: (_workspace, who) => (who === SLAVO ? "Slavo" : who === ANA ? "Ana" : who),
          taskOf: () => "vl-7",
        })),
      ),
      (made) => Effect.promise(() => made.dispose()),
    );
    yield* peer.agents.attach(fixture.broker);
    const rpc = yield* RpcTest.makeClient(TestReportsRpcGroup).pipe(
      Effect.provide(
        PeerHub.rpcLayer(wrap).pipe(
          Layer.provide(
            Layer.mergeAll(coreRpcStandIns, Layer.succeed(PeerPlugins.PeerPlugins, peer.plugins)),
          ),
        ),
      ),
    );
    const as = { "x-peer-session": "claude:one", "x-peer-cwd": fixture.root };
    /** `peer tests …` as agent `one`: what it printed, or what its refusal prints. */
    const tests = (args: ReadonlyArray<string>) =>
      Effect.promise(async () => {
        await fixture.register("one");
        try {
          return await fixture.broker["runCli"]("tests", args, as);
        } catch (error) {
          if (error instanceof CliError) return render(error);
          throw error;
        }
      });
    /** A shell command agent `one` ran, as its PostToolUse hook (or PostToolUseFailure) reports it. */
    const ran = (command: string, failed = false) =>
      Effect.promise(() =>
        fixture.broker["hook"](
          {
            hook_event_name: failed ? "PostToolUseFailure" : "PostToolUse",
            session_id: "one",
            cwd: fixture.root,
            tool_name: "Bash",
            tool_input: { command },
          },
          {},
        ),
      );
    return { hub, peer, fixture, rpc, tests, ran };
  });

/** The bodies the Hub was sent with `method`. */
export const sent = (
  hub: Effect.Success<ReturnType<typeof ready>>["hub"],
  method: string,
): ReadonlyArray<Record<string, unknown>> =>
  hub.calls
    .filter((call) => call.method === method && call.url?.startsWith(TESTS))
    .map((call) => JSON.parse(call.body) as Record<string, unknown>);

export { PEER_TEST_REPORTS_METHODS };

it("keeps a report the way the Hub's wire contract reads it", () => {
  assert.strictEqual(reportOf().items[1]?.owner, SLAVO);
});
