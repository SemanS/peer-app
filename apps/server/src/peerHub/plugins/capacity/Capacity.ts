// @effect-diagnostics nodeBuiltinImport:off - a shared capacity's config directory on this computer, and its instance id's hash.
/**
 * Capacity: a workspace project's shared AI capacity on this environment. Turning it on for a
 * project gets this environment a gateway key from the Hub and adds a Claude provider instance
 * holding it, with a config directory of its own so no cached subscription login sits next to the
 * key. The keys and instances follow the workspaces that grant them: signing out revokes the keys
 * while the Hub session still holds, leaving a workspace drops its instances (the Hub revoked its
 * keys), and a sync drops those the workspaces no longer grant. Turning shared capacity off revokes
 * this environment's keys and removes its instances, so every project shows it off afterwards.
 *
 * @module peerHub/plugins/capacity/Capacity
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import {
  PeerHubError,
  ProviderDriverKind,
  ProviderInstanceId,
  type PeerHubProjectInput,
  type PeerHubProjectUsage,
  type PeerHubSharedCapacityInput,
  type PeerHubStatus,
  type PeerProject,
  type PeerProjectState,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";

import * as Settings from "../../../serverSettings.ts";
import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import type { PeerLifecycleEvent } from "../../core/plugin.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import { projectKey, type PersistedWorkspace } from "../../core/state/PeerState.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import { capacityHub } from "./hub.ts";

/** "workspace/project" → the project's shared capacity here, as the status shows it. */
type SharedCapacity = Record<string, PeerProjectState["sharedCapacity"]>;

const hubError = (detail: string) => new PeerHubError({ detail });

/** The provider instance holding a project's gateway key here. */
function sharedInstanceId(workspace: string, projectId: string): ProviderInstanceId {
  const id = `peer-${workspace}-${projectId}-claude`;
  if (id.length <= 64) return ProviderInstanceId.make(id);
  const digest = NodeCrypto.createHash("sha256")
    .update(projectKey(workspace, projectId))
    .digest("hex");
  return ProviderInstanceId.make(`peer-${digest.slice(0, 16)}-claude`);
}

export class Capacity extends Context.Service<
  Capacity,
  {
    /** Each project's shared capacity here: the projects that have it on, or failed to. */
    readonly shared: Effect.Effect<SharedCapacity>;
    /** Turns a project's shared capacity on or off on this environment. */
    readonly set: (input: PeerHubSharedCapacityInput) => Effect.Effect<PeerHubStatus, PeerHubError>;
    /** What a project spent this period, shared and as its members reported it. */
    readonly usage: (
      input: PeerHubProjectInput,
    ) => Effect.Effect<PeerHubProjectUsage, PeerHubError>;
    /** Keeps the keys and instances in step with signing out, leaving and each sync. */
    readonly follow: (event: PeerLifecycleEvent) => Effect.Effect<void>;
    /**
     * Revokes every gateway key of this environment and removes every instance holding one; fails
     * naming the keys the Hub did not revoke. Run under the state lock.
     */
    readonly revokeAll: Effect.Effect<void, PeerHubError>;
  }
>()("t3/peerHub/plugins/capacity/Capacity") {}

const make = Effect.gen(function* () {
  const state = yield* PeerState.PeerState;
  const status = yield* PeerStatus.PeerStatus;
  const settings = yield* Settings.ServerSettingsService;
  const client = yield* PeerHubClient.PeerHubClient;
  const hub = capacityHub(client);
  const { environmentId, hubHome } = state;
  /** "workspace/project" → why its shared capacity could not be turned on. */
  const errors = yield* Ref.make<ReadonlyMap<string, string>>(new Map());

  /** Drops the local provider instances of a workspace project's shared capacity. */
  const removeInstances = (key: string) =>
    Effect.gen(function* () {
      const ids = (yield* state.read).persisted.sharedInstances[key] ?? [];
      for (const id of ids) {
        yield* settings
          .updateProviderInstance({ operation: "remove", instanceId: ProviderInstanceId.make(id) })
          .pipe(Effect.ignoreCause({ log: true }));
      }
      yield* state.updatePersisted((p) => {
        const { [key]: _removed, ...rest } = p.sharedInstances;
        return { ...p, sharedInstances: rest };
      });
    });

  /** Revokes this environment's gateway key for the project, then drops its instances. */
  const turnOffShared = (workspace: string, projectId: string) =>
    Effect.gen(function* () {
      if (Option.isSome(yield* client.storedSession)) {
        yield* hub
          .revoke(workspace, projectId, environmentId)
          .pipe(Effect.ignoreCause({ log: true }));
      }
      yield* removeInstances(projectKey(workspace, projectId));
    });

  const enable = (workspace: PersistedWorkspace, project: PeerProject) =>
    Effect.gen(function* () {
      yield* client.session;
      if (project.capacity.shared === undefined) {
        return yield* hubError(`${project.name} has no shared capacity.`);
      }
      const credentials = yield* hub.issue(workspace.slug, project.id, environmentId);
      const claudeModels = credentials.models
        .filter((m) => m.harness.includes("claude"))
        .map((m) => m.id);
      if (claudeModels.length === 0) {
        yield* hub
          .revoke(workspace.slug, project.id, environmentId)
          .pipe(Effect.ignoreCause({ log: true }));
        return yield* hubError(
          `${project.name}'s shared capacity has no Claude models for this app yet.`,
        );
      }
      const pick = (family: string) => claudeModels.find((id) => id.includes(family));
      const homePath = NodePath.join(hubHome, workspace.slug, "claude", project.id);
      yield* Effect.tryPromise(() =>
        NodeFSP.mkdir(homePath, { recursive: true, mode: 0o700 }),
      ).pipe(
        Effect.mapError(() => hubError("Could not create the shared capacity's config directory.")),
      );
      const instanceId = sharedInstanceId(workspace.slug, project.id);
      const aliases = [
        ["ANTHROPIC_DEFAULT_OPUS_MODEL", pick("opus")],
        ["ANTHROPIC_DEFAULT_SONNET_MODEL", pick("sonnet")],
        ["ANTHROPIC_DEFAULT_HAIKU_MODEL", pick("haiku")],
      ] as const;
      yield* settings
        .updateProviderInstance({
          operation: "upsert",
          instanceId,
          instance: {
            driver: ProviderDriverKind.make("claudeAgent"),
            displayName: `${project.name} · ${workspace.name} capacity`,
            enabled: true,
            environment: [
              { name: "ANTHROPIC_BASE_URL", value: credentials.baseUrl, sensitive: false },
              { name: "ANTHROPIC_AUTH_TOKEN", value: credentials.apiKey, sensitive: true },
              // An inherited API key must not win over the gateway key.
              { name: "ANTHROPIC_API_KEY", value: "", sensitive: false },
              ...aliases.flatMap(([name, value]) =>
                value === undefined ? [] : [{ name, value, sensitive: false }],
              ),
            ],
            // Its own config directory, so no cached subscription login sits next to the gateway key.
            config: { homePath },
          },
        })
        .pipe(Effect.mapError(() => hubError("Could not save the shared capacity provider.")));
      yield* state.updatePersisted((p) => ({
        ...p,
        sharedInstances: {
          ...p.sharedInstances,
          [projectKey(workspace.slug, project.id)]: [instanceId],
        },
      }));
    });

  const set: Capacity["Service"]["set"] = Effect.fn("Capacity.set")(function* (input) {
    const { workspace, project } = yield* state.project(input.workspace, input.projectId);
    const key = projectKey(workspace.slug, project.id);
    if (input.enabled) {
      const result = yield* enable(workspace, project).pipe(Effect.result);
      if (Result.isFailure(result)) {
        yield* Ref.update(errors, (current) => new Map(current).set(key, result.failure.detail));
        yield* status.publish;
        return yield* result.failure;
      }
    } else {
      yield* turnOffShared(workspace.slug, project.id);
    }
    yield* Ref.update(errors, (current) => {
      const next = new Map(current);
      next.delete(key);
      return next;
    });
    return yield* status.publish;
  }, state.lock.withPermits(1));

  const follow: Capacity["Service"]["follow"] = (event) =>
    Effect.gen(function* () {
      const keys = Object.keys((yield* state.read).persisted.sharedInstances);
      if (event.kind === "signing-out") {
        // Revoked while the Hub session still holds.
        for (const key of keys) {
          const [workspace = "", projectId = ""] = key.split("/");
          yield* turnOffShared(workspace, projectId);
        }
        yield* Ref.set(errors, new Map());
      } else if (event.kind === "left-workspace") {
        // The hub revoked this member's keys; the local instances go too.
        for (const key of keys) {
          if (key.startsWith(`${event.workspace}/`)) yield* removeInstances(key);
        }
      } else if (event.kind === "synced") {
        // Shared capacity the workspaces no longer grant (or workspaces left) goes away too.
        const stillShared = new Set(
          event.workspaces.flatMap((w) =>
            (w.manifest?.projects ?? [])
              .filter((p) => p.capacity.shared !== undefined)
              .map((p) => projectKey(w.slug, p.id)),
          ),
        );
        for (const key of keys) {
          if (!stillShared.has(key)) yield* removeInstances(key);
        }
      }
    }).pipe(Effect.ignoreCause({ log: true }));

  const revokeAll: Capacity["Service"]["revokeAll"] = Effect.gen(function* () {
    const unrevoked: Array<string> = [];
    for (const key of Object.keys((yield* state.read).persisted.sharedInstances)) {
      const [workspace = "", projectId = ""] = key.split("/");
      const revoked = yield* hub.revoke(workspace, projectId, environmentId).pipe(Effect.result);
      if (Result.isFailure(revoked)) unrevoked.push(`${key} (${revoked.failure.detail})`);
      // The instances go whatever the Hub said: nothing here holds a key any more.
      yield* removeInstances(key);
    }
    yield* Ref.set(errors, new Map());
    if (unrevoked.length > 0) {
      return yield* hubError(
        `The Hub did not revoke this environment's shared capacity keys of ${unrevoked.join(", ")}.`,
      );
    }
  });

  return Capacity.of({
    shared: Effect.gen(function* () {
      const { persisted } = yield* state.read;
      const failed = yield* Ref.get(errors);
      const shared: SharedCapacity = {};
      for (const key of new Set([...Object.keys(persisted.sharedInstances), ...failed.keys()])) {
        const instanceIds = persisted.sharedInstances[key] ?? [];
        const error = failed.get(key);
        shared[key] = {
          enabled: instanceIds.length > 0,
          instanceIds: [...instanceIds],
          ...(error === undefined ? {} : { error }),
        };
      }
      return shared;
    }),
    set,
    usage: (input) => hub.usage(input.workspace, input.projectId),
    follow,
    revokeAll,
  });
});

export const layer = Layer.effect(Capacity, make);
