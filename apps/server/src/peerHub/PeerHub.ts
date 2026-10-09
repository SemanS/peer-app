/**
 * PeerHub — this environment's link to a Peer Hub and its workspaces.
 *
 * A person signs in with their email address (the hub mails a one-time
 * code), then joins the workspaces their address qualifies for — by its
 * domain or an invite — or creates one. Each workspace tells this environment
 * which projects to check out, which agent tools and knowledge they use, and
 * what shared AI capacity each one has. Provisioning stays local:
 * repositories are cloned with the person's own git credentials, projects are
 * ordinary T3 projects, and shared capacity becomes an ordinary provider
 * instance holding a per-member, per-project gateway key.
 *
 * Personal capacity never passes through here. The hub never sees provider
 * logins, and `hubPolicy` keeps hub-provisioned (shared) instances on their
 * own project and personal ones on projects that accept them.
 *
 * Peer's entry: `layer` builds core and the plugins and keeps them current, `rpcLayer` serves their
 * WebSocket methods, and `mcpLayer` their MCP tools.
 *
 * @module peerHub/PeerHub
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as PeerAdapters from "./core/coordination/PeerAdapters.ts";
import * as PeerAgents from "./core/coordination/PeerAgents.ts";
import * as PeerCoordination from "./core/coordination/PeerCoordination.ts";
import * as PeerHubClient from "./core/hub/PeerHubClient.ts";
import * as PeerHubEvents from "./core/hub/PeerHubEvents.ts";
import * as PeerIndex from "./core/index/PeerIndex.ts";
import * as PeerPlugins from "./core/plugins/PeerPlugins.ts";
import * as PeerRpc from "./core/rpc.ts";
import * as PeerState from "./core/state/PeerState.ts";
import * as PeerStatus from "./core/status/PeerStatus.ts";
import * as PeerWork from "./core/work/PeerWork.ts";
import * as PeerWorkspaces from "./core/workspaces/PeerWorkspaces.ts";

const WORK_INTERVAL = "30 seconds";
const MANIFEST_INTERVAL = "10 minutes";

/** Peer's core services. */
const coreLayer = PeerAdapters.layer.pipe(
  Layer.provideMerge(PeerCoordination.layer),
  Layer.provideMerge(PeerAgents.layer),
  Layer.provideMerge(PeerIndex.layer),
  Layer.provideMerge(PeerWorkspaces.layer),
  Layer.provideMerge(PeerHubEvents.layer),
  Layer.provideMerge(PeerWork.layer),
  Layer.provideMerge(PeerStatus.layer),
  Layer.provideMerge(PeerPlugins.layer),
  Layer.provideMerge(PeerHubClient.layer),
  Layer.provideMerge(PeerState.layer),
);

/**
 * What keeps core current while Peer runs: workspaces synced and work refreshed on a timer, the
 * Hub's pings followed, the plugins started, coordination resumed when it was on, and the persisted
 * state published at once so policy and tools apply before the first sync.
 */
const run = Effect.gen(function* () {
  const state = yield* PeerState.PeerState;
  const client = yield* PeerHubClient.PeerHubClient;
  const events = yield* PeerHubEvents.PeerHubEvents;
  const work = yield* PeerWork.PeerWork;
  const workspaces = yield* PeerWorkspaces.PeerWorkspaces;
  const coordination = yield* PeerCoordination.PeerCoordination;
  const { publish } = yield* PeerStatus.PeerStatus;
  const layerScope = yield* Effect.scope;
  const requireSession = client.session;

  const background = <A, E>(effect: Effect.Effect<A, E>) =>
    effect.pipe(
      Effect.andThen(publish),
      Effect.ignoreCause({ log: true }),
      Effect.forkIn(layerScope),
      Effect.asVoid,
    );

  /** Reports this computer's threads to each workspace and reads everyone's work back. */
  const refreshWork = work.refresh().pipe(state.lock.withPermits(1));

  // Keep the manifests fresh and colleagues' presence current.
  yield* Effect.forever(
    Effect.sleep(MANIFEST_INTERVAL).pipe(
      Effect.andThen(requireSession.pipe(Effect.option)),
      Effect.flatMap((signedIn) =>
        Option.isSome(signedIn) ? workspaces.sync.pipe(Effect.ignore) : Effect.void,
      ),
    ),
  ).pipe(Effect.forkScoped);
  yield* Effect.forever(
    Effect.sleep(WORK_INTERVAL).pipe(
      Effect.andThen(refreshWork),
      Effect.andThen(publish),
      Effect.ignoreCause({ log: true }),
    ),
  ).pipe(Effect.forkScoped);
  yield* events
    .follow({
      readWork: work.readWork,
      coordinationChanged: coordination.hubChanged,
      projectsChanged: background(workspaces.sync),
    })
    .pipe(Effect.forkScoped);
  yield* PeerPlugins.startPlugins;
  if ((yield* state.read).persisted.coordination?.enabled === true) {
    yield* background(coordination.start);
  }
  // Publish the persisted state right away so policy and tools apply before the first sync.
  yield* publish.pipe(
    Effect.andThen(requireSession.pipe(Effect.option)),
    Effect.flatMap((signedIn) =>
      Option.isSome(signedIn) ? workspaces.sync.pipe(Effect.ignore) : Effect.void,
    ),
    Effect.ignoreCause({ log: true }),
    Effect.forkScoped,
  );
});

/** Peer's core and its plugins, kept current while the server runs. */
export const layer = Layer.effectDiscard(run).pipe(Layer.provideMerge(coreLayer));

/** Peer's WebSocket RPC handlers, which `ws.ts` merges with T3's (`core/rpc.ts`). */
export const rpcLayer = PeerRpc.layer;

/**
 * Peer's MCP toolkits, registered when the server starts: each plugin's, whose tools refuse their
 * calls while the plugin is inactive.
 */
export const mcpLayer = Layer.unwrap(
  Effect.gen(function* () {
    const toolkits = yield* (yield* PeerPlugins.PeerPlugins).toolkits;
    return Layer.mergeAll(Layer.empty, ...toolkits);
  }),
);
