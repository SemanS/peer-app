// @effect-diagnostics nodeBuiltinImport:off - realpath probes and the atomic peer-hub.json write.
/**
 * PeerState: this environment's Peer state and where its files live.
 *
 * The persisted part is `peer-hub.json` in the state directory, written whole to a temporary file
 * and renamed over the old one. The runtime part is what Peer last read from the Hub and from this
 * computer. Changes to Hub state run one at a time under `lock`; background clones only touch their
 * own checkout.
 *
 * @module peerHub/core/state/PeerState
 */
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  PeerCoordinationPolicy,
  PeerHubError,
  PeerJoinableWorkspace,
  PeerManifest,
  PeerWorkspaceRole,
  type EnvironmentId,
  type PeerPluginId,
  type PeerProject,
  type PeerTask,
  type PeerWorkThread,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as ServerConfig from "../../../config.ts";
import * as ServerEnvironment from "../../../environment/ServerEnvironment.ts";
import { run } from "../local.ts";

export const PersistedWorkspace = Schema.Struct({
  slug: Schema.String,
  name: Schema.String,
  role: PeerWorkspaceRole,
  allowedDomains: Schema.Array(Schema.String),
  manifest: Schema.NullOr(PeerManifest),
  lastSyncAt: Schema.NullOr(Schema.String),
});
export type PersistedWorkspace = typeof PersistedWorkspace.Type;

export const PersistedState = Schema.Struct({
  hubUrl: Schema.NullOr(Schema.String),
  email: Schema.NullOr(Schema.String),
  pendingSignIn: Schema.NullOr(
    Schema.Struct({
      email: Schema.String,
      sentAt: Schema.String,
      echoedCode: Schema.optional(Schema.String),
    }),
  ),
  workspaces: Schema.Array(PersistedWorkspace),
  joinable: Schema.Array(PeerJoinableWorkspace),
  lastSyncAt: Schema.NullOr(Schema.String),
  /**
   * "workspace/project" → provider instances this environment provisioned for its shared capacity:
   * shared capacity's, and what the runtime capacity policy (`hubPolicy.ts`) binds to projects.
   */
  sharedInstances: Schema.Record(Schema.String, Schema.Array(Schema.String)),
  /** Address → workspaces that person left on this computer; signing in does not rejoin them. */
  leftWorkspaces: Schema.optional(Schema.Record(Schema.String, Schema.Array(Schema.String))),
  /** This computer's threads (`peer:<thread id>`, `herdr:<terminal id>`) → the task they work on. */
  assignments: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Struct({ workspace: Schema.String, project: Schema.String, task: Schema.String }),
    ),
  ),
  /** "workspace/project/repository" → a checkout this computer shared from where it already was. */
  localCheckouts: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  /** Agents on the same project staying out of each other's way, on this computer (experimental). */
  coordination: Schema.optional(
    Schema.Struct({ enabled: Schema.Boolean, policy: PeerCoordinationPolicy }),
  ),
  /**
   * This computer's threads (`peer:…`, `herdr:…`) whose owner lets the team watch them: observe's,
   * kept where `peer-hub.json` always had them.
   */
  sharedThreads: Schema.optional(Schema.Array(Schema.String)),
  /** Plugin id → its owner's choice here; a plugin without one has its default. */
  plugins: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)),
  /** Plugin id → data only that plugin reads and writes (`PeerState.pluginData`). */
  pluginData: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});
export type PersistedState = typeof PersistedState.Type;

const decodePersisted = Schema.decodeUnknownOption(Schema.fromJsonString(PersistedState));
const encodePersisted = Schema.encodeSync(Schema.fromJsonString(PersistedState));

/** A fresh install's state, and what signing out goes back to. */
export const EMPTY_PERSISTED: PersistedState = {
  hubUrl: null,
  email: null,
  pendingSignIn: null,
  workspaces: [],
  joinable: [],
  lastSyncAt: null,
  sharedInstances: {},
};

export interface Transient {
  readonly state: "cloning" | "error";
  readonly error?: string;
  /** Signing in to GitHub with an account that can open the repository fixes the error. */
  readonly gitHubSignIn?: boolean;
}

export interface ProjectWork {
  readonly areas: ReadonlyArray<string>;
  readonly tasks: ReadonlyArray<PeerTask>;
  readonly threads: ReadonlyArray<PeerWorkThread>;
}

/** The state Peer works from. */
export interface RuntimeState {
  readonly persisted: PersistedState;
  readonly syncing: boolean;
  readonly error: string | null;
  /** Workspace slug → why its last manifest refresh failed. */
  readonly workspaceErrors: ReadonlyMap<string, string>;
  /** Checkout path → an in-flight clone or its failure. */
  readonly checkouts: ReadonlyMap<string, Transient>;
  /** Workspace slug → its knowledge clone in flight or failed. */
  readonly knowledge: ReadonlyMap<string, Transient>;
  /** "workspace/project" → its areas, tasks and other environments' threads, as the hub last said. */
  readonly work: ReadonlyMap<string, ProjectWork>;
}

/** A workspace project's repository checkout. */
export interface PeerPlace {
  readonly workspace: string;
  readonly projectId: string;
  readonly repositoryId: string;
}

/** A plugin's own slice of `peer-hub.json`. */
export interface PeerPluginData<A> {
  /** None when the plugin stored nothing, or what it stored no longer decodes. */
  readonly read: Effect.Effect<Option.Option<A>>;
  /** Saves the slice at once; run it under `lock` where other writes may race it. */
  readonly update: (f: (current: Option.Option<A>) => A) => Effect.Effect<void, PeerHubError>;
}

/** The key of a workspace project in `RuntimeState.work` and the persisted shared instances. */
export const projectKey = (workspace: string, projectId: string) => `${workspace}/${projectId}`;

/** Ids from the hub become directory names; anything but kebab-case is refused. */
export function safeId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,62}$/.test(id);
}

/** The task one of this computer's threads was put on in a workspace project, if any. */
export function assignedTask(
  persisted: PersistedState,
  thread: string,
  workspace: string,
  projectId: string,
): string | undefined {
  const assignment = persisted.assignments?.[thread];
  return assignment !== undefined &&
    assignment.workspace === workspace &&
    assignment.project === projectId
    ? assignment.task
    : undefined;
}

export function realpathOrSelf(path: string): string {
  try {
    return NodeFS.realpathSync(path);
  } catch {
    return path;
  }
}

/** Workspace projects are checked out under ~/Peer/<workspace>/<project>/<repository> unless PEER_WORKSPACE says otherwise. */
function resolveWorkspaceRoot(): string {
  const configured = process.env.PEER_WORKSPACE?.trim();
  if (configured) return NodePath.resolve(configured.replace(/^~(?=$|\/)/, NodeOS.homedir()));
  return NodePath.join(NodeOS.homedir(), "Peer");
}

const hubError = (detail: string) => new PeerHubError({ detail });

export class PeerState extends Context.Service<
  PeerState,
  {
    /** This environment's id, as the Hub and clients know it. */
    readonly environmentId: EnvironmentId;
    /** Where workspace projects are checked out. */
    readonly workspaceRoot: string;
    /** Peer's own files under the T3 home: company knowledge clones, shared capacity homes. */
    readonly hubHome: string;
    /** Where a workspace's company knowledge is cloned. */
    readonly knowledgePath: (workspace: string) => string;
    readonly read: Effect.Effect<RuntimeState>;
    /** The state now, for callbacks that run outside Effect (the coordination broker's). */
    readonly current: () => RuntimeState;
    /** Saves a change to the persisted state; the runtime copy changes once the file is written. */
    readonly updatePersisted: (
      f: (persisted: PersistedState) => PersistedState,
    ) => Effect.Effect<void, PeerHubError>;
    readonly updateRuntime: (f: (state: RuntimeState) => RuntimeState) => Effect.Effect<void>;
    /** Changes to Hub state run one at a time under it. */
    readonly lock: Semaphore.Semaphore;
    /** The signed-in person's address; null when nobody is. */
    readonly email: Effect.Effect<string | null>;
    readonly workspaces: Effect.Effect<ReadonlyArray<PersistedWorkspace>>;
    /** A project of a workspace this person belongs to, or why there is none. */
    readonly project: (
      workspace: string,
      projectId: string,
    ) => Effect.Effect<
      { readonly workspace: PersistedWorkspace; readonly project: PeerProject },
      PeerHubError
    >;
    /** Where a repository lives here: where it was shared from, or under the workspace root. */
    readonly checkoutPath: (
      persisted: PersistedState,
      workspace: string,
      projectId: string,
      repoId: string,
    ) => string;
    /** The workspace project whose checkout holds `path`, if any. */
    readonly projectOfPath: (
      persisted: PersistedState,
      path: string | undefined,
    ) => PeerPlace | undefined;
    /**
     * The workspace project a directory is in, with the repository working tree around it; a
     * worktree of a workspace checkout counts as that checkout. Null outside them.
     */
    readonly placeOf: (cwd: string) => Effect.Effect<{
      readonly workspace: string;
      readonly project: string;
      readonly root: string;
      readonly repositoryId: string;
    } | null>;
    /** What a workspace calls a person: their name in its manifest, else one made of their address. */
    readonly nameOf: (workspace: string, email: string) => string;
    readonly pluginData: <A, I>(
      plugin: PeerPluginId,
      schema: Schema.Codec<A, I>,
    ) => PeerPluginData<A>;
  }
>()("t3/peerHub/core/state/PeerState") {}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const environmentId = yield* (yield* ServerEnvironment.ServerEnvironment).getEnvironmentId;

  const statePath = NodePath.join(config.stateDir, "peer-hub.json");
  const hubHome = NodePath.join(config.baseDir, "hub");
  const workspaceRoot = resolveWorkspaceRoot();

  const loaded = yield* Effect.tryPromise(() => NodeFSP.readFile(statePath, "utf8")).pipe(
    Effect.map((text) => Option.getOrElse(decodePersisted(text), () => EMPTY_PERSISTED)),
    Effect.orElseSucceed(() => EMPTY_PERSISTED),
  );
  const ref = yield* Ref.make<RuntimeState>({
    persisted: loaded,
    syncing: false,
    error: null,
    workspaceErrors: new Map(),
    checkouts: new Map(),
    knowledge: new Map(),
    work: new Map(),
  });
  const lock = yield* Semaphore.make(1);

  const persist = (persisted: PersistedState) =>
    Effect.tryPromise(async () => {
      await NodeFSP.mkdir(NodePath.dirname(statePath), { recursive: true });
      const temp = `${statePath}.${process.pid}.tmp`;
      await NodeFSP.writeFile(temp, `${encodePersisted(persisted)}\n`, { mode: 0o600 });
      await NodeFSP.rename(temp, statePath);
    }).pipe(Effect.mapError(() => hubError("Could not save the workspace state.")));

  const updatePersisted: PeerState["Service"]["updatePersisted"] = (f) =>
    Effect.gen(function* () {
      const next = f((yield* Ref.get(ref)).persisted);
      yield* persist(next);
      yield* Ref.update(ref, (s) => ({ ...s, persisted: next }));
    });

  const checkoutPath: PeerState["Service"]["checkoutPath"] = (
    persisted,
    workspace,
    projectId,
    repoId,
  ) =>
    persisted.localCheckouts?.[`${workspace}/${projectId}/${repoId}`] ??
    NodePath.join(workspaceRoot, workspace, projectId, repoId);

  const projectOfPath: PeerState["Service"]["projectOfPath"] = (persisted, path) => {
    if (path === undefined) return undefined;
    const target = realpathOrSelf(path);
    for (const workspace of persisted.workspaces) {
      for (const project of workspace.manifest?.projects ?? []) {
        for (const repo of project.repositories) {
          const root = realpathOrSelf(checkoutPath(persisted, workspace.slug, project.id, repo.id));
          if (target === root || target.startsWith(`${root}${NodePath.sep}`)) {
            return { workspace: workspace.slug, projectId: project.id, repositoryId: repo.id };
          }
        }
      }
    }
    return undefined;
  };

  const placeOf: PeerState["Service"]["placeOf"] = (cwd) =>
    Effect.promise(async () => {
      const toplevel = await run("git", ["-C", cwd, "rev-parse", "--show-toplevel"]).catch(
        () => null,
      );
      if (toplevel === null || toplevel === "") return null;
      const { persisted } = Ref.getUnsafe(ref);
      // A worktree of a workspace checkout counts as that checkout.
      const common = await run("git", [
        "-C",
        cwd,
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
      ]).catch(() => null);
      const place =
        projectOfPath(persisted, toplevel) ??
        (common === null ? undefined : projectOfPath(persisted, NodePath.dirname(common)));
      return place === undefined
        ? null
        : {
            workspace: place.workspace,
            project: place.projectId,
            root: realpathOrSelf(toplevel),
            repositoryId: place.repositoryId,
          };
    });

  const project: PeerState["Service"]["project"] = (workspaceSlug, projectId) =>
    Effect.gen(function* () {
      const workspace = (yield* Ref.get(ref)).persisted.workspaces.find(
        (w) => w.slug === workspaceSlug,
      );
      if (workspace === undefined) {
        return yield* hubError(`You are not a member of the workspace "${workspaceSlug}".`);
      }
      const found = workspace.manifest?.projects.find((p) => p.id === projectId);
      if (found === undefined || !safeId(found.id)) {
        return yield* hubError(`${workspace.name} gives you no project "${projectId}".`);
      }
      return { workspace, project: found };
    });

  const nameOf: PeerState["Service"]["nameOf"] = (slug, email) => {
    const workspace = Ref.getUnsafe(ref).persisted.workspaces.find((w) => w.slug === slug);
    for (const project of workspace?.manifest?.projects ?? []) {
      const name = project.members.find((member) => member.email === email)?.name;
      if (name !== undefined && name !== "") return name;
    }
    // Someone the manifest does not name yet: ana.novak@… reads as Ana.
    const local = email.split("@")[0]?.split(/[._-]/)[0] ?? email;
    return local === "" ? email : `${local[0]?.toUpperCase() ?? ""}${local.slice(1)}`;
  };

  const pluginData: PeerState["Service"]["pluginData"] = (plugin, schema) => {
    const decode = Schema.decodeUnknownOption(schema);
    const encode = Schema.encodeSync(schema);
    const stored = (persisted: PersistedState) =>
      persisted.pluginData !== undefined && Object.hasOwn(persisted.pluginData, plugin)
        ? decode(persisted.pluginData[plugin])
        : Option.none();
    return {
      read: Ref.get(ref).pipe(Effect.map((s) => stored(s.persisted))),
      update: (f) =>
        updatePersisted((persisted) => ({
          ...persisted,
          pluginData: { ...persisted.pluginData, [plugin]: encode(f(stored(persisted))) },
        })),
    };
  };

  return PeerState.of({
    environmentId,
    workspaceRoot,
    hubHome,
    knowledgePath: (workspace) => NodePath.join(hubHome, workspace, "knowledge"),
    read: Ref.get(ref),
    current: () => Ref.getUnsafe(ref),
    updatePersisted,
    updateRuntime: (f) => Ref.update(ref, f),
    lock,
    email: Ref.get(ref).pipe(Effect.map((s) => s.persisted.email)),
    workspaces: Ref.get(ref).pipe(Effect.map((s) => s.persisted.workspaces)),
    project,
    checkoutPath,
    projectOfPath,
    placeOf,
    nameOf,
    pluginData,
  });
});

export const layer = Layer.effect(PeerState, make);
