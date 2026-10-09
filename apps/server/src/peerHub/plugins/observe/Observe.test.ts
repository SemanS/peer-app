import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { ObserveRpcGroup, type PeerAgentView, type PeerHubStatus } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";
import * as RpcTest from "effect/unstable/rpc/RpcTest";

import type { ReportedThread } from "../../core/hub/hubApi.ts";
import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import * as PeerHubEvents from "../../core/hub/PeerHubEvents.ts";
import type { PeerRpcWrap } from "../../core/plugin.ts";
import * as PeerPlugins from "../../core/plugins/PeerPlugins.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import {
  coreLayer,
  paymentsSeed,
  paymentsT3,
  seedState,
  signedInSeed,
  standInHub,
  type HubAnswer,
} from "../../core/testkit.ts";
import * as PeerHub from "../../PeerHub.ts";
import { observeHub } from "./hub.ts";
import { ObservePlugin } from "./index.ts";

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

const EVENTS = "/v1/workspaces/acme/events";
const THREADS = "/v1/workspaces/acme/threads";
/** Where Ana's Peer sends the views of her thread-1 while someone watches it. */
const ANAS = "/v1/workspaces/acme/observe/ana-laptop/peer%3Athread-1";
/** Where the Hub relays Bob's shared thread to Ana. */
const BOBS = "/v1/workspaces/acme/observe/bob-laptop/peer%3Abob-1";

const BOB_VIEW: PeerAgentView = {
  agentId: "peer:bob-1",
  title: "Refund flow",
  status: "working",
  gone: false,
};

/**
 * A Hub where acme's event stream and the relay of Bob's thread stay open, one colleague watches
 * whatever Ana's Peer sends, and anything else is taken. Each call's path goes to `asked`.
 */
const acmeHub =
  (asked: Queue.Queue<string>): HubAnswer =>
  (url) => {
    Queue.offerUnsafe(asked, url);
    return url === EVENTS
      ? { events: ":\n\n", open: true }
      : url === BOBS
        ? {
            events: `event: view\ndata: {"agentId":"peer:bob-1","title":"Refund flow","status":"working","gone":false}\n\n`,
            open: true,
          }
        : url === ANAS
          ? [200, { watchers: 1 }]
          : url === "/v1/workspaces/acme/work"
            ? [200, { projects: {} }]
            : [200, {}];
  };

/** Waits until the Hub was asked for `path`. */
const askedFor = (asked: Queue.Queue<string>, path: string) =>
  Effect.gen(function* () {
    while ((yield* Queue.take(asked)) !== path);
  });

const refusal = <A, E extends { readonly message: string }, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.result,
    Effect.map((result) => (Result.isFailure(result) ? result.failure.message : null)),
  );

describe("observing", () => {
  it.effect("relays a shared thread's views and drops what is not one", () =>
    Effect.gen(function* () {
      const view = { agentId: "peer:1", title: "Split payments", status: "working", gone: false };
      const hub = yield* standInHub({
        current: (url) =>
          url === "/v1/workspaces/acme/observe/ana-laptop/peer%3A1"
            ? {
                events: [
                  'event: view\ndata: {"agentId":"peer:1","title":"Split payments","status":"working","gone":false}\n\n',
                  'event: view\ndata: {"title":1}\n\n',
                  ":\n\n",
                ].join(""),
              }
            : [404, {}],
      });
      const core = yield* Layer.build(
        coreLayer(yield* seedState(signedInSeed(hub.url)), { session: "phs_test" }),
      );
      const relay = observeHub(yield* PeerHubClient.PeerHubClient.pipe(Effect.provide(core)));
      const views = yield* Stream.runCollect(relay.relay("acme", "ana-laptop", "peer:1"));
      assert.deepStrictEqual(Array.from(views), [view]);
      assert.strictEqual(
        hub.calls.find((call) => call.url?.includes("/observe/"))?.authorization,
        "Bearer phs_test",
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("observe turned off", () => {
  it.effect(
    "ends watching, reports the threads as not watchable, and leaves them unshared once on",
    () =>
      Effect.gen(function* () {
        const asked = yield* Queue.unbounded<string>();
        const hub = yield* standInHub({ current: acmeHub(asked) });
        const core = yield* Layer.build(
          coreLayer(yield* seedState(paymentsSeed(hub.url)), {
            session: "phs_test",
            plugins: [ObservePlugin],
            t3: paymentsT3,
          }),
        );
        const { status, plugins } = yield* Effect.gen(function* () {
          const status = yield* PeerStatus.PeerStatus;
          yield* status.setFacadeParts(() =>
            Effect.succeed({ agents: { herdr: "not-running", list: [] }, coordination }),
          );
          yield* PeerPlugins.startPlugins;
          yield* (yield* PeerHubEvents.PeerHubEvents)
            .follow({
              readWork: () => Effect.void,
              coordinationChanged: Effect.void,
              projectsChanged: Effect.void,
              listeners: [],
            })
            .pipe(Effect.forkScoped);
          return { status, plugins: yield* PeerPlugins.PeerPlugins };
        }).pipe(Effect.provide(core));
        yield* askedFor(asked, EVENTS);
        /** The threads this environment last reported to acme. */
        const reported = () =>
          (
            JSON.parse(hub.calls.findLast((call) => call.url === THREADS)?.body ?? "{}") as {
              readonly threads?: ReadonlyArray<ReportedThread>;
            }
          ).threads ?? [];

        const wrap: PeerRpcWrap = {
          effect: (_method, effect) => effect,
          stream: (_method, stream) => stream,
        };
        const handlers = PeerHub.rpcLayer(wrap).pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(PeerHub.PeerHub)({}),
              Layer.succeed(PeerPlugins.PeerPlugins, plugins),
            ),
          ),
        );
        yield* Effect.gen(function* () {
          const client = yield* RpcTest.makeClient(ObserveRpcGroup);
          const share = client["peerHub.shareThread"]({ thread: "peer:thread-1", shared: true });
          assert.deepStrictEqual((yield* share).sharedThreads, ["peer:thread-1"]);
          assert.include(
            reported().find((thread) => thread.id === "peer:thread-1"),
            {
              observable: true,
            },
          );

          // Ana watches Bob's thread, and Bob starts watching hers.
          const views = yield* Queue.unbounded<PeerAgentView>();
          const watching = yield* client["peerHub.observeThread"]({
            workspace: "acme",
            environment: "bob-laptop",
            thread: "peer:bob-1",
          }).pipe(
            Stream.runForEach((view) => Queue.offer(views, view)),
            Effect.forkScoped,
          );
          assert.deepStrictEqual(yield* Queue.take(views), BOB_VIEW);
          hub.push(
            EVENTS,
            'event: observe\ndata: {"origin":"bob-laptop","environment":"ana-laptop","thread":"peer:thread-1"}\n\n',
          );
          yield* askedFor(asked, ANAS);

          yield* plugins.setPlugin({ id: "observe", enabled: false });
          // Ana's watching ended with it.
          yield* Fiber.join(watching);
          const off = yield* status.publish;
          assert.deepStrictEqual(off.sharedThreads, []);
          const thread = reported().find((candidate) => candidate.id === "peer:thread-1");
          assert.isDefined(thread);
          assert.notProperty(thread, "observable");
          assert.strictEqual(yield* refusal(share), "Observe is turned off on this environment.");

          yield* plugins.setPlugin({ id: "observe", enabled: true });
          const on = yield* status.publish;
          assert.deepStrictEqual(on.sharedThreads, []);
          assert.isTrue(
            on.plugins?.some((plugin) => plugin.id === "observe" && plugin.active) ?? false,
          );
        }).pipe(Effect.provide(handlers));
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
