/**
 * Peer Core: Peer's coordination runtime without the desktop app (`t3 peer-core`). The same core
 * and plugins as the app's server, over headless stand-ins for what only the app has: projects are
 * the folders registered here, there are no app threads, settings are read from settings.json, and
 * nothing is relayed. The environment's identity, secrets and state are the app's own files, so
 * the app picks up where Peer Core left off (and takes the broker over when it starts).
 *
 * @module peerHub/headless/PeerCoreRuntime
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { FetchHttpClient } from "effect/http";

import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import * as ServerConfig from "../../config.ts";
import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import { PeerBrokerKind } from "../core/broker/owner.ts";
import type { PeerContributions, PeerPluginEntry } from "../core/plugin.ts";
import { PeerPluginRegistry, peerPlugins } from "../core/registry.ts";
import * as PeerState from "../core/state/PeerState.ts";
import * as PeerHub from "../PeerHub.ts";
import * as HeadlessProjections from "./HeadlessProjections.ts";
import * as HeadlessProjects from "./HeadlessProjects.ts";
import * as HeadlessRelay from "./HeadlessRelay.ts";
import * as HeadlessSettings from "./HeadlessSettings.ts";

/** Why a plugin is off headless when it could not start without the app. */
export const NEEDS_APP = "needs the Peer app";

/**
 * This build's plugins, each kept from taking Peer Core down: one whose services cannot start
 * headless is logged, contributes nothing and shows as forced off.
 */
export const headlessPlugins = (
  entries: ReadonlyArray<PeerPluginEntry> = peerPlugins(),
): ReadonlyArray<PeerPluginEntry> =>
  entries.map((entry) => {
    let failed = false;
    return {
      ...entry,
      forcedOff: () => (failed ? NEEDS_APP : entry.forcedOff?.()),
      contributions: entry.contributions.pipe(
        Effect.catchCause((cause) =>
          Effect.sync(() => {
            failed = true;
          }).pipe(
            Effect.andThen(Effect.logWarning(`Peer Core: plugin ${entry.id} ${NEEDS_APP}`, cause)),
            Effect.as({} as PeerContributions),
          ),
        ),
      ),
    };
  });

/**
 * This environment's identity from `<stateDir>/environment-id`, the app's own: one broker per
 * environment id, so Peer Core and the app are the same computer to the Hub.
 */
const environmentLayer = Layer.effect(
  ServerEnvironment.ServerEnvironment,
  Effect.gen(function* () {
    const identity = yield* ServerEnvironment.ServerEnvironmentIdentity;
    return ServerEnvironment.ServerEnvironment.of({
      getEnvironmentId: identity.getEnvironmentId,
      getDescriptor: Effect.die(
        new Error("Peer Core has no environment descriptor; it serves no T3 clients."),
      ),
    });
  }),
).pipe(Layer.provide(ServerEnvironment.layerIdentity));

/** What the app's server gives Peer's core, headless, on `config`. */
export const servicesLayer = (config: ServerConfig.ServerConfig["Service"]) => {
  const base = Layer.mergeAll(ServerSecretStore.layer, environmentLayer).pipe(
    Layer.provideMerge(ServerConfig.layer(config)),
  );
  return Layer.mergeAll(
    HeadlessProjects.layer,
    HeadlessProjections.layer,
    HeadlessSettings.layer,
    HeadlessRelay.layer,
    FetchHttpClient.layer,
    Layer.succeed(PeerBrokerKind, "peer-core"),
    Layer.succeed(PeerPluginRegistry, headlessPlugins()),
  ).pipe(Layer.provideMerge(base));
};

/** Peer Core running: core, plugins, the Hub followed and the broker on (unless turned off). */
export const layer = (config: ServerConfig.ServerConfig["Service"]) =>
  PeerHub.layer.pipe(Layer.provideMerge(servicesLayer(config)));

/** Core for one command that exits: nothing starts in the background. */
export const oneShotLayer = (config: ServerConfig.ServerConfig["Service"]) =>
  PeerHub.coreLayer.pipe(Layer.provideMerge(servicesLayer(config)));

/** Peer's persisted state alone, read once: what `status` and `bind` use; writes only a binding (`placeOf`, `bind`) while no broker runs. */
export const stateLayer = (config: ServerConfig.ServerConfig["Service"]) =>
  PeerState.layer.pipe(Layer.provideMerge(servicesLayer(config)));
