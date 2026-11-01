/**
 * PeerPlugins: which of Peer's optional plugins run on this environment.
 *
 * A plugin is active while this build includes it, it is turned on (its owner's choice, or its
 * default) and the signed-in Hub serves the feature it needs. Core reads activity once per hook,
 * command and request and skips inactive plugins entirely, so a plugin turned off contributes
 * nothing from the next step on, without a restart. Its background `run` runs exactly while it is
 * active; turning it off also runs its `turnOff`.
 *
 * @module peerHub/core/plugins/PeerPlugins
 */
import {
  PEER_PLUGIN_REASONS,
  PeerHubError,
  type PeerHubSetPluginInput,
  type PeerPluginId,
  type PeerPluginState,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FiberMap from "effect/FiberMap";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as PeerHubClient from "../hub/PeerHubClient.ts";
import type { PeerContributions, PeerCore, PeerPluginEntry, PeerPluginInfo } from "../plugin.ts";
import { PeerPluginRegistry, validatePlugins } from "../registry.ts";
import * as PeerState from "../state/PeerState.ts";

/** An active plugin's contributions, as core composes them. */
export interface ActivePlugin {
  readonly requiresHub?: boolean;
  readonly id: PeerPluginId;
  readonly title: string;
  readonly contributions: PeerContributions;
}

/** The capability slots at most one plugin fills. */
export type CapabilitySlot = "runtime" | "taskLauncher" | "wipSharing";

/** The first of `providers` (see `contributions`) that fills `slot`, if any does. */
export const capability = <K extends CapabilitySlot>(
  providers: ReadonlyArray<PeerContributions>,
  slot: K,
): PeerContributions[K] | undefined =>
  providers.find((provider) => provider[slot] !== undefined)?.[slot];

const hubError = (detail: string) => new PeerHubError({ detail });
const isPeerHubError = Schema.is(PeerHubError);

const unknownPlugin = (id: string) =>
  hubError(`There is no Peer plugin "${id}" on this environment.`);

/** What a failure says, in a line. */
const failureText = (cause: Cause.Cause<unknown>) => {
  const failure = Cause.squash(cause);
  return isPeerHubError(failure)
    ? failure.detail
    : failure instanceof Error
      ? failure.message
      : String(failure);
};

export class PeerPlugins extends Context.Service<
  PeerPlugins,
  {
    /** Whether the plugin is active now. */
    readonly isActive: (id: string) => Effect.Effect<boolean>;
    /**
     * Succeeds while the plugin is active; otherwise fails saying it is turned off here or needs a
     * newer Hub. Core guards every plugin request and tool with it.
     */
    readonly requireActive: (id: string) => Effect.Effect<void, PeerHubError>;
    /** Every plugin of this build, in registry order, as the status lists them. */
    readonly states: Effect.Effect<ReadonlyArray<PeerPluginState>>;
    /** The active plugins' contributions, in registry order. */
    readonly active: Effect.Effect<ReadonlyArray<ActivePlugin>>;
    /** Every plugin of this build with its state and contributions, active or not. */
    readonly built: Effect.Effect<
      ReadonlyArray<{
        readonly state: PeerPluginState;
        readonly contributions: PeerContributions;
      }>
    >;
    /**
     * The active plugins' contributions in registry order: what core reads capability slots, report
     * additions and lifecycle handlers from.
     */
    readonly contributions: Effect.Effect<ReadonlyArray<PeerContributions>>;
    /**
     * The active plugin that fills a capability slot; otherwise fails saying why none does: the
     * plugin that would is turned off here or needs a newer Hub, or this build has none.
     */
    readonly require: <K extends CapabilitySlot>(
      slot: K,
    ) => Effect.Effect<NonNullable<PeerContributions[K]>, PeerHubError>;
    /**
     * Records the owner's choice and applies it at once: an active plugin's work starts, an
     * inactive one's stops, and turning a plugin off runs its `turnOff`. Takes the state lock.
     */
    readonly setPlugin: (input: PeerHubSetPluginInput) => Effect.Effect<void, PeerHubError>;
    /**
     * Takes the plugins' contributions once `startPlugins` built them, and starts the active ones'
     * work. Building needs core, PeerPlugins included, which is why it is a step of its own.
     */
    readonly attach: (built: ReadonlyMap<string, PeerContributions>) => Effect.Effect<void>;
  }
>()("t3/peerHub/core/plugins/PeerPlugins") {}

/** Whether a Hub serves the feature a plugin needs, at the revision it needs or a later one. */
const servedBy = (entry: PeerPluginInfo, features: PeerHubClient.HubFeatures) =>
  entry.hubFeature === undefined ||
  (features[entry.hubFeature.id] ?? 0) >= entry.hubFeature.revision;

const make = Effect.gen(function* () {
  const state = yield* PeerState.PeerState;
  const client = yield* PeerHubClient.PeerHubClient;
  const registry = yield* PeerPluginRegistry;
  const attached = yield* Ref.make<ReadonlyMap<string, PeerContributions>>(new Map());
  const errors = yield* Ref.make<ReadonlyMap<string, string>>(new Map());
  const fibers = yield* FiberMap.make<string>();
  const reconciling = yield* Semaphore.make(1);

  const setError = (id: string, error: string | null) =>
    Ref.update(errors, (current) => {
      const next = new Map(current);
      if (error === null) next.delete(id);
      else next.set(id, error);
      return next;
    });

  const states: PeerPlugins["Service"]["states"] = Effect.gen(function* () {
    const { persisted } = yield* state.read;
    const features = yield* client.features;
    const read = yield* client.featuresRead;
    const failed = yield* Ref.get(errors);
    return registry.map((entry): PeerPluginState => {
      const forcedOff = entry.forcedOff?.();
      const enabled =
        forcedOff === undefined && (persisted.plugins?.[entry.id] ?? entry.defaultEnabled);
      const served = servedBy(entry, features);
      const error = failed.get(entry.id);
      return {
        id: entry.id,
        title: entry.title,
        enabled,
        active: enabled && served,
        ...(forcedOff !== undefined
          ? { reason: forcedOff, locked: true }
          : !enabled
            ? { reason: PEER_PLUGIN_REASONS.off }
            : served
              ? {}
              : // Unserved by the legacy set a Hub's answer has not replaced: no Hub said so yet.
                { reason: read ? PEER_PLUGIN_REASONS.hub : PEER_PLUGIN_REASONS.hubUnknown }),
        ...(error === undefined ? {} : { error }),
      };
    });
  });

  /** A plugin's background work while it is active: restarted, with a growing pause, after a failure. */
  const supervise = (id: string, run: Effect.Effect<void, never, Scope.Scope>) =>
    Effect.gen(function* () {
      let failures = 0;
      while (true) {
        const exit = yield* Effect.exit(Effect.scoped(run));
        if (Exit.isSuccess(exit) || Cause.hasInterruptsOnly(exit.cause)) return;
        failures += 1;
        yield* setError(id, failureText(exit.cause));
        yield* Effect.logWarning("A Peer plugin's background work failed; it starts again", {
          plugin: id,
          cause: Cause.pretty(exit.cause),
        });
        yield* Effect.sleep(Math.min(60_000, 1_000 * 2 ** Math.min(failures, 6)));
      }
    });

  /** Starts the work of plugins that became active and stops that of those that did not. */
  const reconcile = Effect.gen(function* () {
    const built = yield* Ref.get(attached);
    for (const plugin of yield* states) {
      const run = built.get(plugin.id)?.run;
      if (run === undefined) continue;
      if (plugin.active) {
        yield* FiberMap.run(fibers, plugin.id, supervise(plugin.id, run), { onlyIfMissing: true });
      } else {
        yield* FiberMap.remove(fibers, plugin.id);
      }
    }
  }).pipe(reconciling.withPermits(1));

  const isActive: PeerPlugins["Service"]["isActive"] = (id) =>
    Effect.map(states, (all) => all.some((plugin) => plugin.id === id && plugin.active));

  const requireActive: PeerPlugins["Service"]["requireActive"] = (id) =>
    Effect.gen(function* () {
      const plugin = (yield* states).find((candidate) => candidate.id === id);
      if (plugin === undefined) return yield* unknownPlugin(id);
      if (plugin.active) return;
      return yield* hubError(
        plugin.reason === PEER_PLUGIN_REASONS.hubUnknown
          ? `${plugin.title} waits for a Peer Hub: it works once this environment is signed in and its Hub answers.`
          : plugin.reason !== PEER_PLUGIN_REASONS.hub
            ? `${plugin.title} is turned off on this environment.`
            : `${plugin.title} needs a newer Peer Hub.`,
      );
    });

  const active: PeerPlugins["Service"]["active"] = Effect.gen(function* () {
    const built = yield* Ref.get(attached);
    const now = new Map((yield* states).map((plugin) => [plugin.id, plugin.active]));
    return registry.flatMap((entry) => {
      const contributions = built.get(entry.id);
      return contributions !== undefined && now.get(entry.id) === true
        ? [
            {
              id: entry.id,
              title: entry.title,
              contributions,
              ...(entry.hubFeature === undefined ? {} : { requiresHub: true }),
            },
          ]
        : [];
    });
  });

  const built: PeerPlugins["Service"]["built"] = Effect.gen(function* () {
    const contributed = yield* Ref.get(attached);
    return (yield* states).flatMap((state) => {
      const contributions = contributed.get(state.id);
      return contributions === undefined ? [] : [{ state, contributions }];
    });
  });

  const contributions: PeerPlugins["Service"]["contributions"] = Effect.map(active, (plugins) =>
    plugins.map((plugin) => plugin.contributions),
  );

  const require: PeerPlugins["Service"]["require"] = (slot) =>
    Effect.gen(function* () {
      const found = capability(yield* contributions, slot);
      if (found !== undefined) return found;
      const owner = (yield* built).find((plugin) => plugin.contributions[slot] !== undefined);
      if (owner !== undefined) yield* requireActive(owner.state.id);
      return yield* hubError("This environment has no Peer plugin that does that.");
    });

  const setPlugin: PeerPlugins["Service"]["setPlugin"] = (input) =>
    Effect.gen(function* () {
      const entry = registry.find((candidate) => candidate.id === input.id);
      if (entry === undefined) return yield* unknownPlugin(input.id);
      const forcedOff = entry.forcedOff?.();
      if (forcedOff !== undefined) {
        if (input.enabled) return yield* hubError(`${entry.title} is forced off by ${forcedOff}.`);
        return;
      }
      const { persisted } = yield* state.read;
      const wasEnabled = persisted.plugins?.[entry.id] ?? entry.defaultEnabled;
      yield* state.updatePersisted((p) => ({
        ...p,
        plugins: { ...p.plugins, [entry.id]: input.enabled },
      }));
      // Its work stops before its cleanup runs, so nothing redoes what the cleanup undoes.
      yield* reconcile;
      if (input.enabled) {
        yield* setError(entry.id, null);
        return;
      }
      if (!wasEnabled) return;
      const turnOff = (yield* Ref.get(attached)).get(entry.id)?.turnOff;
      const cleaned = yield* Effect.exit(turnOff ?? Effect.void);
      if (Exit.isSuccess(cleaned)) {
        yield* setError(entry.id, null);
        return;
      }
      // The choice stands; what could not be undone shows as the plugin's error.
      yield* setError(entry.id, failureText(cleaned.cause));
      yield* Effect.logWarning("A Peer plugin could not undo its effects when turned off", {
        plugin: entry.id,
        cause: Cause.pretty(cleaned.cause),
      });
    }).pipe(state.lock.withPermits(1));

  const attach: PeerPlugins["Service"]["attach"] = (built) =>
    Effect.gen(function* () {
      const problems = validatePlugins(
        registry.map((entry) => ({
          id: entry.id,
          commands: built.get(entry.id)?.commands ?? entry.commandNames?.map((name) => ({ name })),
        })),
      );
      if (problems.length > 0) {
        return yield* Effect.die(new Error(`Peer's plugins collide: ${problems.join(" ")}`));
      }
      yield* Ref.set(attached, built);
      yield* reconcile;
    });

  // A Hub that starts or stops serving a feature turns its plugins on or off here.
  yield* client.featureChanges.pipe(
    Stream.runForEach(() => reconcile),
    Effect.forkScoped,
  );

  return PeerPlugins.of({
    isActive,
    requireActive,
    states,
    active,
    built,
    contributions,
    require,
    setPlugin,
    attach,
  });
});

export const layer = Layer.effect(PeerPlugins, make);

/**
 * Builds every plugin of this build in the caller's scope and attaches them. The PeerHub layer
 * runs it once, with all of core in its context.
 */
export const startPlugins = Effect.gen(function* () {
  const plugins = yield* PeerPlugins;
  const built = new Map<string, PeerContributions>();
  const registry: ReadonlyArray<PeerPluginEntry> = yield* PeerPluginRegistry;
  for (const entry of registry) {
    built.set(entry.id, yield* entry.contributions);
  }
  yield* plugins.attach(built);
}) satisfies Effect.Effect<void, never, PeerCore | PeerPlugins | Scope.Scope>;
