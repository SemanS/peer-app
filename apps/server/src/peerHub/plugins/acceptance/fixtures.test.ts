// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off - the bodies the Hub was sent.
/**
 * What this plugin's tests share: Ana, a lead of Payments, signed in to a stand-in Hub that serves
 * `acceptance` (design D4), with the plugin started and the project's tasks VL7 (done) and VL9
 * (open) known, and a broker in a checkout of the project whose agent `one` works on VL7. It holds
 * the module's one test of its own, because a file that is not a test counts against the plugin's
 * line budget.
 */
import { assert, it } from "@effect/vitest";
import {
  AcceptanceRpcGroup,
  PEER_ACCEPTANCE_METHODS,
  type PeerHubStatus,
  type PeerTask,
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
import { AcceptancePlugin } from "./index.ts";

export const ANA = "ana@acme.test";
export const SLAVO = "slavo@acme.test";
export const LIST = "/v1/workspaces/acme/acceptance";
export const VL7 = `${LIST}/pay/vl-7`;
const EVENTS = "/v1/workspaces/acme/events";
const NOW = "2026-10-28T09:00:00.000Z";

const task = (id: string, key: string, status: PeerTask["status"]): PeerTask => ({
  id,
  key,
  title: `Task ${key}`,
  status,
  createdBy: SLAVO,
  createdAt: NOW,
  updatedAt: NOW,
});

const ACCEPTED_AT = "2026-10-28T10:00:00Z";
const accepted = {
  project: "pay",
  task: "vl-7",
  by: ANA,
  at: ACCEPTED_AT,
  note: "Checked on staging",
  statusThen: "review",
};

/**
 * VL7's entry of `GET /acceptance` once Ana accepted it from review, shaped as the Hub's
 * `features/acceptance/routes_tests.rs` reads it (`a_lead_accepts_and_withdraws`,
 * `members_read_the_view`): the current acceptance, `beforeReopening` and the history newest first.
 */
export const acceptedEntry = (over: Record<string, unknown> = {}) => ({
  acceptance: accepted,
  beforeReopening: false,
  history: [{ seq: 1, kind: "accepted", by: ANA, at: ACCEPTED_AT, note: "Checked on staging" }],
  ...over,
});

/** VL7's entry once Ana withdrew her acceptance: none now, the withdrawal first in the history. */
export const withdrawnEntry = () => ({
  acceptance: null,
  beforeReopening: false,
  history: [
    { seq: 2, kind: "withdrawn", by: ANA, at: "2026-10-28T11:00:00Z", note: "Refunds fail" },
    ...acceptedEntry().history,
  ],
});

/** `GET /acceptance` as the Hub answers it: per project, per task with any, its entry. */
export const listAnswer = (tasks: Record<string, unknown> = {}) => ({
  projects: Object.keys(tasks).length === 0 ? {} : { pay: tasks },
  at: "2026-10-28T12:00:00Z",
});

/** `POST`/`DELETE …/acceptance/pay/vl-7` as the Hub answers it. */
export const decidedAnswer = (withdrawn: boolean) => ({
  acceptance: withdrawn ? null : accepted,
  status: "done",
  changed: true,
  finished: !withdrawn,
});

export type Route = (url: string, method?: string) => ReturnType<HubAnswer> | undefined;

/** A Hub of acme that serves `acceptance` at `revision` (null: not served), and what `route` adds. */
const acmeHub =
  (current: { route?: Route; revision?: number | null }): HubAnswer =>
  (url, method) =>
    current.route?.(url, method) ??
    (url === "/v1/me"
      ? [200, meAnswer(current.revision === null ? {} : { acceptance: current.revision ?? 1 })]
      : url === EVENTS
        ? { events: ":\n\n", open: true }
        : [404, { error: { code: "not_found", message: "Not here." } }]);

const wrap: PeerRpcWrap = { effect: (_, effect) => effect, stream: (_, stream) => stream };

/** Ana's Peer on the Hub, with the plugin started; a broker over it with agent `one` on VL7. */
export const ready = (
  current: { route?: Route; revision?: number | null },
  vl7: PeerTask["status"] = "done",
) =>
  Effect.gen(function* () {
    const tasks = [task("vl-7", "VL7", vl7), task("vl-9", "VL9", "open")];
    const hub = yield* standInHub({ current: acmeHub(current) });
    const core = yield* Layer.build(
      coreLayer(yield* seedState(paymentsSeed(hub.url)), {
        session: "phs_test",
        plugins: [AcceptancePlugin],
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
        work: new Map([
          [
            "acme/pay",
            {
              areas: [],
              tasks,
              threads: [],
            },
          ],
        ]),
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
          taskOf: () => "vl-7",
          tasks: () => tasks,
        })),
      ),
      (made) => Effect.promise(() => made.dispose()),
    );
    yield* peer.agents.attach(fixture.broker);
    const rpc = yield* RpcTest.makeClient(AcceptanceRpcGroup).pipe(
      Effect.provide(
        PeerHub.rpcLayer(wrap).pipe(
          Layer.provide(
            Layer.mergeAll(coreRpcStandIns, Layer.succeed(PeerPlugins.PeerPlugins, peer.plugins)),
          ),
        ),
      ),
    );
    /** `peer <command> …` as agent `one`: what it printed, or what its refusal prints. */
    const cli = (command: string, args: ReadonlyArray<string> = []) =>
      Effect.promise(async () => {
        await fixture.register("one");
        try {
          return await fixture.broker["runCli"](command, args, {
            "x-peer-session": "claude:one",
            "x-peer-cwd": fixture.root,
          });
        } catch (error) {
          if (error instanceof CliError) return render(error);
          throw error;
        }
      });
    return { hub, peer, rpc, cli };
  });

/** The calls the Hub had below `/acceptance/…` with `method`, with their bodies. */
export const writes = (hub: Effect.Success<ReturnType<typeof ready>>["hub"], method: string) =>
  hub.calls
    .filter((call) => call.method === method && call.url?.startsWith(`${LIST}/`))
    .map((call) => ({ url: call.url, body: JSON.parse(call.body) as Record<string, unknown> }));

export { PEER_ACCEPTANCE_METHODS };

it("keeps the Hub's entry the way its wire contract reads it", () => {
  assert.strictEqual(acceptedEntry().acceptance.statusThen, "review");
});
