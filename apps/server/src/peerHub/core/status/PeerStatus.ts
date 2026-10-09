/**
 * PeerStatus: the Peer status every client receives, and its stream.
 *
 * Core assembles its own fields and hands the runtime policy its state. Each active plugin's slice
 * is read from memory on every publish and placed by core: the plugins that existed before plugins
 * keep their old fields (`legacy.ts`), which read neutral values while the plugin is inactive, and
 * later plugins get an optional field named after their camel-cased id, omitted while inactive.
 * Slices count against every publish's payload, so plugins put counts and ids there and keep detail
 * behind their own requests. A status equal to the last one is not sent again.
 *
 * @module peerHub/core/status/PeerStatus
 */
import {
  PeerHubStatus,
  peerPluginStatusFields,
  type PeerPresenceThread,
  type PeerProject,
  type PeerProjectState,
  type PeerWorkThread,
  type PeerWorkspaceState,
  type ProjectId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as ProjectService from "../../../project/ProjectService.ts";
import {
  setHubPolicyState,
  type HubBoundProject,
  type HubSharedInstance,
} from "../../hubPolicy.ts";
import * as PeerHubClient from "../hub/PeerHubClient.ts";
import { commandAvailable, hasGitCheckout } from "../local.ts";
import * as PeerPlugins from "../plugins/PeerPlugins.ts";
import * as PeerState from "../state/PeerState.ts";
import {
  projectKey,
  realpathOrSelf,
  safeId,
  type PersistedWorkspace,
  type RuntimeState,
} from "../state/PeerState.ts";
import { LEGACY_PLACES } from "./legacy.ts";

export class PeerStatus extends Context.Service<
  PeerStatus,
  {
    /** Rebuilds the status and sends it to subscribers when it changed. */
    readonly publish: Effect.Effect<PeerHubStatus>;
    /** The status now, then every change. */
    readonly changes: Stream.Stream<PeerHubStatus>;
    /**
     * Where the status's coordination comes from: PeerAdapters, which reads Peer's hooks and the
     * broker, and publishes through this service, hands its reader over as it starts, before
     * anything publishes.
     */
    readonly coordinationFrom: (
      read: (state: RuntimeState) => Effect.Effect<PeerHubStatus["coordination"]>,
    ) => Effect.Effect<void>;
  }
>()("t3/peerHub/core/status/PeerStatus") {}

const encodeStatus = Schema.encodeSync(Schema.fromJsonString(PeerHubStatus));
const isPluginFields = Schema.is(Schema.Struct(peerPluginStatusFields));
const LEGACY_PLUGINS: ReadonlySet<string> = new Set(LEGACY_PLACES.map((place) => place.plugin));

/** A later plugin's own status field: its id in camel case (`team-requests` → `teamRequests`). */
export const statusField = (id: string) =>
  id.replace(/-([a-z0-9])/g, (_, next: string) => next.toUpperCase());

/** Colleagues' environments that have a thread working or blocked, for "Working now". */
function peersOf(
  threads: ReadonlyArray<PeerWorkThread>,
  names: ReadonlyMap<string, string>,
): PeerProjectState["peers"] {
  const byEnvironment = new Map<
    string,
    {
      email: string;
      name: string;
      environment: string;
      threads: PeerPresenceThread[];
      seenAt: string;
    }
  >();
  for (const thread of threads) {
    if (thread.status !== "working" && thread.status !== "blocked") continue;
    const key = `${thread.email} ${thread.environment}`;
    const entry = byEnvironment.get(key) ?? {
      email: thread.email,
      name: names.get(thread.email) ?? thread.email,
      environment: thread.environment,
      threads: [],
      seenAt: thread.seenAt,
    };
    entry.threads.push({
      title: thread.title,
      status: thread.status,
      ...(thread.branch === undefined ? {} : { branch: thread.branch }),
      ...(thread.harness === undefined ? {} : { harness: thread.harness }),
    });
    if (thread.seenAt > entry.seenAt) entry.seenAt = thread.seenAt;
    byEnvironment.set(key, entry);
  }
  return [...byEnvironment.values()];
}

const make = Effect.gen(function* () {
  const state = yield* PeerState.PeerState;
  const client = yield* PeerHubClient.PeerHubClient;
  const plugins = yield* PeerPlugins.PeerPlugins;
  const projects = yield* ProjectService.ProjectService;
  const { environmentId, checkoutPath, knowledgePath } = state;

  const coordinationOf = yield* Ref.make<
    Option.Option<(s: RuntimeState) => Effect.Effect<PeerHubStatus["coordination"]>>
  >(Option.none());
  const lastStatus = yield* Ref.make<PeerHubStatus | null>(null);
  const changes = yield* Effect.acquireRelease(PubSub.unbounded<PeerHubStatus>(), PubSub.shutdown);

  const projectState = (
    workspace: PersistedWorkspace,
    project: PeerProject,
    s: RuntimeState,
  ): Effect.Effect<{
    readonly state: PeerProjectState;
    readonly bound: ReadonlyArray<readonly [string, ProjectId | undefined, HubBoundProject]>;
  }> =>
    Effect.gen(function* () {
      const ref = { slug: workspace.slug, name: workspace.name };
      const bound: Array<readonly [string, ProjectId | undefined, HubBoundProject]> = [];
      const repositories = [];
      for (const repo of project.repositories) {
        if (!safeId(repo.id)) continue;
        const path = checkoutPath(s.persisted, workspace.slug, project.id, repo.id);
        const transient = s.checkouts.get(path);
        const ready = hasGitCheckout(path);
        const t3Project = ready
          ? yield* projects.getByWorkspaceRoot(path).pipe(Effect.orElseSucceed(() => Option.none()))
          : Option.none();
        const projectId = Option.isSome(t3Project) ? t3Project.value.id : undefined;
        if (ready) bound.push([path, projectId, { workspace: ref, project, repositoryPath: path }]);
        repositories.push({
          id: repo.id,
          url: repo.url,
          branch: repo.branch,
          path,
          state: transient?.state ?? (ready ? ("ready" as const) : ("missing" as const)),
          ...(transient?.error === undefined ? {} : { error: transient.error }),
          ...(transient?.gitHubSignIn === true ? { gitHubSignIn: true } : {}),
          ...(projectId === undefined ? {} : { projectId }),
        });
      }
      const key = projectKey(workspace.slug, project.id);
      const names = new Map(project.members.map((m) => [m.email, m.name]));
      const work = s.work.get(key);
      const assignments: Record<string, string> = {};
      for (const [thread, assignment] of Object.entries(s.persisted.assignments ?? {})) {
        if (assignment.workspace === workspace.slug && assignment.project === project.id) {
          assignments[thread] = assignment.task;
        }
      }
      return {
        bound,
        state: {
          project,
          repositories,
          tools: project.tools.map((tool) => ({
            id: tool.id,
            name: tool.name,
            missing: tool.requires
              .filter((requirement) => !commandAvailable(requirement.command))
              .map((requirement) => ({
                command: requirement.command,
                ...(requirement.install === undefined ? {} : { install: requirement.install }),
              })),
          })),
          sharedCapacity: { enabled: false, instanceIds: [] },
          work: {
            areas: work?.areas ?? project.areas ?? [],
            tasks: work?.tasks ?? [],
            threads: work?.threads ?? [],
            assignments,
          },
          peers: peersOf(
            (work?.threads ?? []).filter(
              (thread) =>
                thread.email !== s.persisted.email || thread.environment !== environmentId,
            ),
            names,
          ),
        },
      };
    });

  /** Core's fields, and the runtime policy's new state. */
  const coreStatus = (s: RuntimeState) =>
    Effect.gen(function* () {
      const session = yield* client.storedSession;
      const readCoordination = yield* Ref.get(coordinationOf);
      if (Option.isNone(readCoordination)) {
        return yield* Effect.die(
          new Error(
            "Peer's status was published before PeerAdapters handed over its coordination.",
          ),
        );
      }
      const coordination = yield* readCoordination.value(s);
      const signedIn = Option.isSome(session) && s.persisted.email !== null;
      const byProject = new Map<string, HubBoundProject>();
      const byRoot = new Map<string, HubBoundProject>();
      const knowledgePaths = new Map<string, string>();
      const workspaces: PeerWorkspaceState[] = [];
      for (const workspace of s.persisted.workspaces) {
        const manifest = workspace.manifest;
        const projectStates: PeerProjectState[] = [];
        for (const project of manifest?.projects ?? []) {
          if (!safeId(project.id)) continue;
          const { state: projectStatus, bound } = yield* projectState(workspace, project, s);
          projectStates.push(projectStatus);
          for (const [path, projectId, entry] of bound) {
            byRoot.set(path, entry);
            byRoot.set(realpathOrSelf(path), entry);
            if (projectId !== undefined) byProject.set(projectId, entry);
          }
        }
        const knowledgeRepo = manifest?.knowledge.company;
        const knowledgeTransient = s.knowledge.get(workspace.slug);
        const knowledgeReady =
          knowledgeRepo !== undefined && hasGitCheckout(knowledgePath(workspace.slug));
        if (knowledgeReady) knowledgePaths.set(workspace.slug, knowledgePath(workspace.slug));
        workspaces.push({
          slug: workspace.slug,
          name: workspace.name,
          role: workspace.role,
          allowedDomains: workspace.allowedDomains,
          ...(workspace.domainClaims === undefined ? {} : { domainClaims: workspace.domainClaims }),
          currency: manifest?.workspace.currency ?? "EUR",
          ...(manifest?.workspace.revision === undefined
            ? {}
            : { revision: manifest.workspace.revision }),
          memberName: manifest?.member.name ?? s.persisted.email ?? "",
          companyKnowledge:
            knowledgeRepo === undefined
              ? null
              : {
                  repository: knowledgeRepo.repository,
                  path: knowledgePath(workspace.slug),
                  state: knowledgeTransient?.state ?? (knowledgeReady ? "ready" : "missing"),
                  ...(knowledgeTransient?.error === undefined
                    ? {}
                    : { error: knowledgeTransient.error }),
                },
          projects: projectStates,
          lastSyncAt: workspace.lastSyncAt,
          error: s.workspaceErrors.get(workspace.slug) ?? null,
        });
      }
      const sharedInstances = new Map<string, HubSharedInstance>();
      for (const [key, ids] of Object.entries(s.persisted.sharedInstances)) {
        const [slug = "", projectId = ""] = key.split("/");
        const workspace = s.persisted.workspaces.find((w) => w.slug === slug);
        for (const id of ids) {
          sharedInstances.set(id, {
            workspace: { slug, name: workspace?.name ?? slug },
            projectId,
          });
        }
      }
      const policy =
        s.persisted.workspaces.length === 0 && sharedInstances.size === 0
          ? null
          : { projects: byProject, roots: byRoot, sharedInstances, knowledgePaths };

      return {
        policy,
        status: {
          hubUrl: client.hubUrl(s.persisted),
          signedIn,
          email: signedIn ? s.persisted.email : null,
          pendingSignIn: s.persisted.pendingSignIn,
          workspaces,
          requests: [],
          joinable: signedIn ? s.persisted.joinable : [],
          domainOffers: signedIn ? (s.persisted.domainOffers ?? []) : [],
          removedFrom: signedIn ? (s.persisted.removedFrom ?? []) : [],
          workspaceRoot: state.workspaceRoot,
          environmentId,
          agents: { herdr: "not-running", list: [] },
          github: { cli: false, account: null, signIn: null, error: null },
          coordination,
          sharedThreads: [],
          syncing: s.syncing,
          lastSyncAt: s.persisted.lastSyncAt,
          error: s.error,
        } satisfies PeerHubStatus,
      };
    });

  /** Places the active plugins' slices and lists every plugin. */
  const withPlugins = (core: PeerHubStatus) =>
    Effect.gen(function* () {
      const listed = yield* plugins.states;
      const active = yield* plugins.active;
      const slices = new Map<string, unknown>();
      for (const plugin of active) {
        const contribution = plugin.contributions.status;
        if (contribution !== undefined) slices.set(plugin.id, yield* contribution.read);
      }
      let status = core;
      for (const place of LEGACY_PLACES) {
        // A feature not moved into a plugin yet keeps core's value.
        if (!listed.some((plugin) => plugin.id === place.plugin)) continue;
        if (!active.some((plugin) => plugin.id === place.plugin)) status = place.neutral(status);
        else if (slices.has(place.plugin)) status = place.place(status, slices.get(place.plugin));
      }
      const fields: Record<string, unknown> = {};
      for (const [id, slice] of slices) {
        const field = statusField(id);
        if (!LEGACY_PLUGINS.has(id) && !Object.hasOwn(status, field)) fields[field] = slice;
      }
      if (!isPluginFields(fields)) {
        yield* Effect.logWarning("A Peer plugin's status slice does not match its contract", {
          fields: Object.keys(fields),
        });
        return { ...status, plugins: listed };
      }
      return Object.assign({}, status, fields, { plugins: listed });
    });

  const publish: PeerStatus["Service"]["publish"] = Effect.gen(function* () {
    while (true) {
      const snapshot = yield* state.read;
      const core = yield* coreStatus(snapshot);
      const status = yield* withPlugins(core.status);
      // Async coordination/project reads may race a sync. Never pair old templates with new slices.
      if ((yield* state.read) !== snapshot) continue;
      setHubPolicyState(core.policy);
      const previous = yield* Ref.getAndSet(lastStatus, status);
      if (previous === null || encodeStatus(previous) !== encodeStatus(status)) {
        yield* PubSub.publish(changes, status);
      }
      return status;
    }
  });

  return PeerStatus.of({
    publish,
    changes: Stream.unwrap(
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(changes);
        const snapshot = yield* publish;
        return Stream.concat(Stream.make(snapshot), Stream.fromSubscription(subscription));
      }),
    ),
    coordinationFrom: (read) => Ref.set(coordinationOf, Option.some(read)),
  });
});

export const layer = Layer.effect(PeerStatus, make);
