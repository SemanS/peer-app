// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off - the bodies the Hub was sent.
/**
 * What this plugin's tests share: a Hub of acme that serves `rooms` and answers from `current`, and
 * a Peer signed in to it as Bob with the plugin started. Bob is on acme's `app` project with Eva.
 */
import { assert, it } from "@effect/vitest";
import type { PeerHubStatus, PeerRoomInbox, PeerRoomMessage, PeerTask } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { brokerFixture, pluginsOf } from "../../core/broker/testkit.ts";
import * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import type { PeerContributions, PeerPluginEntry, PeerSessionView } from "../../core/plugin.ts";
import * as PeerPlugins from "../../core/plugins/PeerPlugins.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import {
  coreLayer,
  meAnswer,
  seedState,
  standInHub,
  TEST_ENVIRONMENT,
  type HubAnswer,
} from "../../core/testkit.ts";
import { RoomsPlugin } from "./index.ts";

export const BOB = "bob@acme.test";
export const EVA = "eva@acme.test";
export const ACME = "/v1/workspaces/acme";
export const ROOM = `${ACME}/projects/app/tasks/vl-7/room`;
const EVENTS = `${ACME}/events`;
export const NOW = "2026-10-30T10:00:00.000Z";

export const TASK: PeerTask = {
  id: "vl-7",
  key: "VL-7",
  title: "Order totals",
  status: "review",
  createdBy: BOB,
  createdAt: NOW,
  updatedAt: NOW,
};

export const messageOf = (over: Partial<PeerRoomMessage> = {}): PeerRoomMessage => ({
  seq: 12,
  task: "vl-7",
  at: NOW,
  author: { email: EVA },
  text: "Why this total?",
  to: [{ kind: "agent", email: BOB, state: "waiting" }],
  ...over,
});

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

export interface RoomHub {
  features: Readonly<Record<string, number>>;
  inbox: PeerRoomInbox;
  /** Answers a call before the room's routes do. */
  route?: (method: string, url: string) => readonly [number, unknown] | undefined;
}

export const roomHubOf = (over: Partial<RoomHub> = {}): RoomHub => ({
  features: { rooms: 1 },
  inbox: { waiting: [], mentions: [], work: [], seqs: {}, revs: {} },
  ...over,
});

/** A Peer signed in as Bob over a stand-in Hub of `current`, with the rooms plugin started. */
export const roomPeer = (current: RoomHub, plugins: ReadonlyArray<PeerPluginEntry> = []) =>
  Effect.gen(function* () {
    const sent: { calls: ReadonlyArray<{ method?: string | undefined }> } = { calls: [] };
    const answer: HubAnswer = (url) => {
      const method = sent.calls.at(-1)?.method ?? "GET";
      const routed = current.route?.(method, url);
      if (routed !== undefined) return routed;
      if (url === "/v1/me") return [200, meAnswer(current.features)];
      if (url === EVENTS) return { events: ":\n\n", open: true };
      if (url.startsWith(`${ACME}/rooms/inbox`)) return [200, current.inbox];
      if (url.startsWith(`${ROOM}/seen`)) return [200, { seen: 12 }];
      if (url.startsWith(ROOM) && method === "GET")
        return [200, { seq: 12, seen: 3, messages: [messageOf()], reaches: [] }];
      if (url.startsWith(ROOM)) return [200, { message: messageOf({ seq: 13 }) }];
      if (url.includes("/reach"))
        return [200, { reach: { run: "run_x", reach: "team", email: BOB, capacity: "shared" } }];
      return [404, { error: { code: "not_found", message: "Not here." } }];
    };
    const server = yield* standInHub({ current: answer });
    sent.calls = server.calls;
    const core = yield* Layer.build(
      coreLayer(yield* seedState(seed(server.url)), {
        session: "phs_test",
        plugins: [...plugins, RoomsPlugin],
      }),
    );
    return yield* Effect.gen(function* () {
      const status = yield* PeerStatus.PeerStatus;
      yield* status.coordinationFrom(() => Effect.succeed(COORDINATION));
      const state = yield* PeerState.PeerState;
      yield* state.updateRuntime((runtime) => ({
        ...runtime,
        work: new Map([["acme/app", { areas: [], tasks: [TASK], threads: [] }]]),
      }));
      const client = yield* PeerHubClient.PeerHubClient;
      yield* client.me;
      yield* PeerPlugins.startPlugins;
      const peerPlugins = yield* PeerPlugins.PeerPlugins;
      const agents = yield* PeerAgents.PeerAgents;
      const brokered = Effect.acquireRelease(
        Effect.gen(function* () {
          const fixture = yield* Effect.promise(() =>
            brokerFixture(() => ({
              ...pluginsOf(peerPlugins),
              environment: TEST_ENVIRONMENT,
              email: () => BOB,
              nameOf: (_workspace, who) => (who === BOB ? "Bob" : who),
            })),
          );
          yield* agents.attach(fixture.broker);
          return fixture;
        }),
        (fixture) => Effect.promise(() => fixture.dispose()),
      );
      return { server, status, state, client, agents, plugins: peerPlugins, brokered };
    }).pipe(Effect.provide(core));
  });

/** The rooms plugin's contributions, as core reads them. */
export const contributionsOf = (peer: Effect.Success<ReturnType<typeof roomPeer>>) =>
  Effect.map(
    peer.plugins.built,
    (built): PeerContributions =>
      built.find(({ state }) => state.id === "rooms")?.contributions ?? {},
  );

/** The first status, now or later, whose rooms satisfy `seen`. */
export const roomsWhen = (
  status: PeerStatus.PeerStatus["Service"],
  seen: (rooms: PeerHubStatus["rooms"]) => boolean,
) =>
  status.changes.pipe(
    Stream.map((next) => next.rooms),
    Stream.filter(seen),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  );

/** A session as hooks and commands see it, with its plugin state kept in memory. */
export const sessionOf = (over: Partial<PeerSessionView> = {}): PeerSessionView => {
  const local = new Map<string, unknown>();
  const told = new Map<string, Set<string>>();
  return {
    id: "claude:one",
    agent: "claude",
    adapter: "mod",
    runtimeGeneration: "g1",
    workspace: "acme",
    project: "app",
    repositoryId: "api",
    root: "/tmp/app",
    cwd: "/tmp/app",
    task: "vl-7",
    run: "run_1",
    thread: undefined,
    pane: undefined,
    status: "working",
    keeps: false,
    files: [],
    claims: [],
    local: <S>(plugin: string, init: () => S) => {
      if (!local.has(plugin)) local.set(plugin, init());
      return local.get(plugin) as S;
    },
    told: (plugin) => {
      const set = told.get(plugin) ?? new Set<string>();
      told.set(plugin, set);
      return set;
    },
    ...over,
  };
};

it("fixtures name the plugin they test", () => {
  assert.strictEqual(RoomsPlugin.id, "rooms");
});
