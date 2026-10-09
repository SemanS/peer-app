import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import type { PeerHubStatus, PeerPluginId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as TestClock from "effect/testing/TestClock";

import { bindPlugin, type PeerHubListener, type PeerPluginEntry } from "../plugin.ts";
import * as PeerPlugins from "../plugins/PeerPlugins.ts";
import * as PeerStatus from "../status/PeerStatus.ts";
import { coreLayer, seedState, signedInSeed, standInHub } from "../testkit.ts";
import * as PeerHubEvents from "./PeerHubEvents.ts";

/** What the acme workspace's event stream sends; ana-laptop is this environment. */
const EVENTS = [
  'event: requests\ndata: {"origin":"bob-laptop"}\n\n',
  'event: plans\ndata: {"origin":"bob-laptop","plan":"q4"}\n\n',
  'event: gossip\ndata: {"origin":"bob-laptop"}\n\n',
  'event: requests\ndata: {"origin":"ana-laptop"}\n\n',
  'event: knowledge.changed\ndata: {"origin":"ana-laptop","projectId":"pay","proposed":2}\n\n',
  'event: work\ndata: {"origin":"ana-laptop"}\n\n',
  'event: coord\ndata: {"origin":"bob-laptop"}\n\n',
  "event: resync\ndata: {}\n\n",
  "event: done\ndata: {}\n\n",
].join("");

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

type Heard = Queue.Queue<string>;

/** The next `count` things heard, as they come (`Queue.takeN` stops at what is there now). */
const nextHeard = (heard: Heard, count: number) =>
  Effect.forEach(Array.from({ length: count }), () => Queue.take(heard));

/** A plugin that only follows the Hub's pings, writing down what it heard. */
const listening = (
  id: PeerPluginId,
  follows: Omit<PeerHubListener, "onPing">,
  heard: Heard,
  defaultEnabled = true,
): PeerPluginEntry =>
  bindPlugin({
    id,
    title: id,
    summary: "A plugin for tests.",
    defaultEnabled,
    layer: Layer.empty,
    make: Effect.succeed({
      hubChanges: {
        ...follows,
        onPing: (ping) =>
          Queue.offer(
            heard,
            `${id} ${ping.change} ${ping.workspace} ${ping.origin ?? "-"} ${Object.values(ping.data).join(",")}`,
          ).pipe(Effect.asVoid),
      },
    }),
  });

/** Core following a stand-in Hub that sends `EVENTS`, with these plugins and core reactions. */
const following = (plugins: (heard: Heard) => ReadonlyArray<PeerPluginEntry>) =>
  Effect.gen(function* () {
    const heard = yield* Queue.unbounded<string>();
    const reacted = yield* Queue.unbounded<string>();
    const hub = yield* standInHub({
      current: (url) => (url === "/v1/workspaces/acme/events" ? { events: EVENTS } : [404, {}]),
    });
    const core = yield* Layer.build(
      coreLayer(yield* seedState(signedInSeed(hub.url)), {
        session: "phs_test",
        plugins: plugins(heard),
      }),
    );
    yield* Effect.gen(function* () {
      yield* (yield* PeerStatus.PeerStatus).setFacadeParts(() =>
        Effect.succeed({ agents: { herdr: "not-running", list: [] }, coordination }),
      );
      yield* PeerPlugins.startPlugins;
      yield* (yield* PeerHubEvents.PeerHubEvents)
        .follow({
          readWork: (workspace) => Queue.offer(reacted, `work ${workspace}`).pipe(Effect.asVoid),
          coordinationChanged: Queue.offer(reacted, "coord").pipe(Effect.asVoid),
          projectsChanged: Queue.offer(reacted, "projects").pipe(Effect.asVoid),
          listeners: [
            {
              changes: ["plans"],
              onPing: (ping) => Queue.offer(heard, `core ${ping.change}`).pipe(Effect.asVoid),
            },
          ],
        })
        .pipe(Effect.forkScoped);
    }).pipe(Effect.provide(core));
    return { heard, reacted };
  });

describe("the Hub's change pings", () => {
  it.effect("reach the active listeners that follow them, and nobody else", () =>
    Effect.gen(function* () {
      const { heard } = yield* following((heard) => [
        listening("requests", { changes: ["requests"] }, heard),
        listening("knowledge", { changes: ["knowledge.changed"], ownEcho: true }, heard),
        listening("find", { changes: ["requests"] }, heard, false),
        listening("ask", { changes: ["done"] }, heard),
      ]);
      // Connecting is a resync for every active listener. Nobody follows `gossip`; this
      // environment's own `requests` reach no listener that skips its own echo; the inactive find
      // plugin hears nothing, not even `resync`.
      assert.deepStrictEqual(yield* nextHeard(heard, 12), [
        "requests resync acme - ",
        "knowledge resync acme - ",
        "ask resync acme - ",
        "core resync",
        "requests requests acme bob-laptop ",
        "core plans",
        "knowledge knowledge.changed acme ana-laptop pay,2",
        "requests resync acme - ",
        "knowledge resync acme - ",
        "ask resync acme - ",
        "core resync",
        "ask done acme - ",
      ]);
      assert.strictEqual(yield* Queue.size(heard), 0);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("read a workspace's work once for a burst, and skip what this environment did", () =>
    Effect.gen(function* () {
      const { heard, reacted } = yield* following((heard) => [
        listening("ask", { changes: ["done"] }, heard),
      ]);
      assert.deepStrictEqual(yield* nextHeard(heard, 6), [
        "ask resync acme - ",
        "core resync",
        "core plans",
        "ask resync acme - ",
        "core resync",
        "ask done acme - ",
      ]);
      // Its own `work` ping read nothing; bob's `coord` and the resync did.
      assert.deepStrictEqual(yield* Queue.takeAll(reacted), ["coord", "coord", "projects"]);
      // Connecting and the resync asked for the work; it is read once, after a short pause.
      yield* TestClock.adjust("300 millis");
      assert.strictEqual(yield* Queue.take(reacted), "work acme");
      assert.strictEqual(yield* Queue.size(reacted), 0);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
