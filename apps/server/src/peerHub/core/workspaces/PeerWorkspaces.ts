// @effect-diagnostics nodeBuiltinImport:off - random ids for the T3 projects a clone opens.
/**
 * PeerWorkspaces: the workspaces this environment's person belongs to, and their checkouts here.
 *
 * A person signs in with a code the Hub mails, then joins the workspaces their address qualifies
 * for, or creates one. Each sync reads what every workspace says: its projects, their
 * repositories and its company knowledge. Repositories are cloned in the background, through the
 * git host that owns them or with the person's own git sign-in, and opened as T3 projects. Plugins
 * hear of signing in and out, of each sync and of each workspace left (`PeerLifecycleEvent`), so
 * what they keep for a workspace follows it.
 *
 * @module peerHub/core/workspaces/PeerWorkspaces
 */
import * as NodeCrypto from "node:crypto";

import {
  CommandId,
  PeerHubError,
  ProjectId,
  type PeerFoundWorkspace,
  type PeerHubBindCheckoutInput,
  type PeerHubCreateWorkspaceInput,
  type PeerHubFindWorkspaceInput,
  type PeerHubFinishSignInInput,
  type PeerHubInviteInput,
  type PeerHubInviteResult,
  type PeerHubProjectInput,
  type PeerHubShareProjectInput,
  type PeerHubStartSignInInput,
  type PeerHubStatus,
  type PeerHubWorkspaceInput,
  type PeerHubJoinWorkspaceInput,
  type PeerProject,
  type PeerWorkspaceMembers,
  type PeerRemovalPlan,
  type PeerMemberKeys,
  type PeerHubMemberInput,
  type PeerHubMemberProjectsInput,
  type PeerHubMemberRoleInput,
  type PeerHubMemberKeysInput,
  type PeerHubFoundingInput,
  type PeerInvitation,
  type PeerInvitationList,
  type PeerHubInvitePreviewInput,
  type PeerInvitePreview,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as PeerAgents from "../coordination/PeerAgents.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import { isSafeGitRef, isSafeGitRemote } from "../../gitSafety.ts";
import { idFromName } from "../../names.ts";
import * as HubApi from "../hub/hubApi.ts";
import * as PeerHubClient from "../hub/PeerHubClient.ts";
import { checkoutState } from "../vcs.ts";
import type { PeerLifecycleEvent } from "../plugin.ts";
import * as PeerPlugins from "../plugins/PeerPlugins.ts";
import * as PeerState from "../state/PeerState.ts";
import {
  projectKey,
  safeId,
  type PersistedState,
  type PersistedWorkspace,
  type Transient,
} from "../state/PeerState.ts";
import { matchRepositories, withoutCredentials } from "../state/remotes.ts";
import * as PeerStatus from "../status/PeerStatus.ts";
import * as PeerWork from "../work/PeerWork.ts";
import { splitJoinable } from "./joinOffers.ts";
import {
  addressedRepository,
  cloneRepository,
  localRepository,
  pullKnowledge,
  type SharedRepository,
} from "./checkouts.ts";

const hubError = (detail: string) => new PeerHubError({ detail });

/** Records (or forgets) that `email` left `slug` here, so signing in again does not rejoin it. */
function markLeft(persisted: PersistedState, email: string | null, slug: string, left: boolean) {
  if (email === null) return persisted;
  const current = (persisted.leftWorkspaces?.[email] ?? []).filter((s) => s !== slug);
  return {
    ...persisted,
    leftWorkspaces: { ...persisted.leftWorkspaces, [email]: left ? [...current, slug] : current },
  };
}

export class PeerWorkspaces extends Context.Service<
  PeerWorkspaces,
  {
    /** Mails a sign-in code to the address. */
    readonly startSignIn: (
      input: PeerHubStartSignInInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    /** Checks the code, joins the workspaces the address's domain admits, and syncs. */
    readonly finishSignIn: (
      input: PeerHubFinishSignInInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    /** Also cancels a sign-in waiting for its code. */
    readonly signOut: Effect.Effect<PeerHubStatus, PeerHubError>;
    readonly signOutEverywhere: Effect.Effect<PeerHubStatus, PeerHubError>;
    readonly members: (
      input: PeerHubWorkspaceInput,
    ) => Effect.Effect<PeerWorkspaceMembers, PeerHubError>;
    readonly removalPlan: (
      input: PeerHubMemberInput,
    ) => Effect.Effect<PeerRemovalPlan, PeerHubError>;
    readonly memberKeys: (input: PeerHubMemberInput) => Effect.Effect<PeerMemberKeys, PeerHubError>;
    readonly removeMember: (
      input: PeerHubMemberInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    readonly setMemberRole: (
      input: PeerHubMemberRoleInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    readonly setMemberProjects: (
      input: PeerHubMemberProjectsInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    readonly withdrawInvite: (
      input: PeerHubMemberInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    readonly revokeMemberKeys: (
      input: PeerHubMemberKeysInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    /** Reads every workspace's manifest again; checkouts and knowledge follow in the background. */
    readonly sync: Effect.Effect<PeerHubStatus, PeerHubError>;
    readonly createWorkspace: (
      input: PeerHubCreateWorkspaceInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    readonly joinWorkspace: (
      input: PeerHubJoinWorkspaceInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    readonly leaveWorkspace: (
      input: PeerHubWorkspaceInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    readonly invite: (
      input: PeerHubInviteInput,
    ) => Effect.Effect<PeerHubInviteResult, PeerHubError>;
    /** The workspace's invitations with their states; null from a Hub that does not list them. */
    readonly invitations: (
      input: PeerHubWorkspaceInput,
    ) => Effect.Effect<PeerInvitationList | null, PeerHubError>;
    /** What inviting an address would reach; null from a Hub that cannot say. */
    readonly invitePreview: (
      input: PeerHubInvitePreviewInput,
    ) => Effect.Effect<PeerInvitePreview | null, PeerHubError>;
    readonly resendInvite: (
      input: PeerHubMemberInput,
    ) => Effect.Effect<PeerInvitation, PeerHubError>;
    /** Accepts an organization founded for this person, as its owner, and syncs. */
    readonly acceptFounding: (
      input: PeerHubFoundingInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    readonly declineFounding: (
      input: PeerHubFoundingInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    /** A workspace by its short name (null when there is none), to join it by name. */
    readonly findWorkspace: (
      input: PeerHubFindWorkspaceInput,
    ) => Effect.Effect<PeerFoundWorkspace | null, PeerHubError>;
    /** Clones the project's repositories (in the background) and registers them as projects. */
    readonly openProject: (
      input: PeerHubProjectInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    /** Shares a local project's repository with a workspace, as a project everyone works on. */
    readonly shareProject: (
      input: PeerHubShareProjectInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    readonly unshareProject: (
      input: PeerHubProjectInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    /**
     * Makes a checkout that is open on this computer the project's repository here, so opening the
     * project does not clone it again. The project may not be in the last manifest yet: a project
     * just created from the settings is bound before this computer has fetched it.
     */
    readonly bindCheckout: (
      input: PeerHubBindCheckoutInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
  }
>()("t3/peerHub/core/workspaces/PeerWorkspaces") {}

const make = Effect.gen(function* () {
  const state = yield* PeerState.PeerState;
  const client = yield* PeerHubClient.PeerHubClient;
  const plugins = yield* PeerPlugins.PeerPlugins;
  const status = yield* PeerStatus.PeerStatus;
  const work = yield* PeerWork.PeerWork;
  const agents = yield* PeerAgents.PeerAgents;
  const projects = yield* ProjectService.ProjectService;
  const scope = yield* Effect.scope;
  const { lock, knowledgePath, checkoutPath } = state;
  const hubApi = client.api;
  const publish = status.publish;

  /** Runs in the background, in this service's scope, and publishes the status once done. */
  const background = <A, E>(effect: Effect.Effect<A, E>) =>
    effect.pipe(
      Effect.andThen(publish),
      Effect.ignoreCause({ log: true }),
      Effect.forkIn(scope),
      Effect.asVoid,
    );

  /** Tells the active plugins what just happened. */
  const announce = (event: PeerLifecycleEvent) =>
    Effect.gen(function* () {
      if (event.kind !== "signed-in" && event.kind !== "task-worktree-created") {
        for (const { contributions } of yield* plugins.built) {
          if (contributions.workspaceCleanup === undefined) continue;
          yield* contributions.workspaceCleanup(event).pipe(Effect.ignore);
        }
      }
      for (const contributions of yield* plugins.contributions) {
        if (contributions.lifecycle === undefined) continue;
        yield* contributions.lifecycle(event).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("A Peer plugin failed on a lifecycle event", {
              event: event.kind,
              cause: Cause.pretty(cause),
            }),
          ),
        );
      }
    });

  /** Clones a workspace's company knowledge repository, or fast-forwards it. */
  const refreshKnowledge = (
    slug: string,
    repository: { readonly repository: string; readonly branch: string },
  ) =>
    Effect.gen(function* () {
      const path = knowledgePath(slug);
      const checkout = yield* Effect.promise(() => checkoutState(path));
      const exists = checkout.state === "ready";
      const setKnowledge = (transient: Transient | null) =>
        state.updateRuntime((s) => {
          const knowledge = new Map(s.knowledge);
          if (transient === null) knowledge.delete(slug);
          else knowledge.set(slug, transient);
          return { ...s, knowledge };
        });
      if (!isSafeGitRemote(repository.repository) || !isSafeGitRef(repository.branch)) {
        yield* setKnowledge({
          state: "error",
          error: "The workspace gives an address git must not clone; ask an admin to fix it.",
        });
        return;
      }
      if (checkout.state === "unsupported") {
        yield* setKnowledge({ state: "error", error: checkout.reason });
        return;
      }
      if (!exists) yield* setKnowledge({ state: "cloning" });
      yield* publish;
      const result = yield* pullKnowledge(repository, path, exists).pipe(Effect.result);
      // A failed pull keeps the last good checkout usable.
      yield* setKnowledge(
        result._tag === "Success" || exists ? null : { state: "error", error: result.failure },
      );
    });

  const syncNow = Effect.gen(function* () {
    const { hubUrl, session } = yield* client.session;
    yield* state.updateRuntime((s) => ({ ...s, syncing: true }));
    yield* publish;
    const me = yield* client.me.pipe(Effect.result);
    if (me._tag === "Failure") {
      if (HubApi.isSessionEnded(me.failure)) {
        yield* announce({ kind: "synced", workspaces: [] });
        yield* client.dropSession;
      }
      yield* state.updateRuntime((s) => ({ ...s, syncing: false, error: me.failure.detail }));
      yield* publish;
      return yield* me.failure;
    }

    const previous = (yield* state.read).persisted.workspaces;
    const workspaceErrors = new Map<string, string>();
    const workspaces: PersistedWorkspace[] = [];
    for (const summary of me.success.workspaces) {
      if (!safeId(summary.slug)) continue;
      const old = previous.find((w) => w.slug === summary.slug);
      const manifest = yield* hubApi.manifest(hubUrl, session, summary.slug).pipe(Effect.result);
      if (manifest._tag === "Failure") workspaceErrors.set(summary.slug, manifest.failure.detail);
      // Capacity is advisory UI data, never a prerequisite for opening a workspace on an older Hub.
      const edition =
        (me.success.features?.editions ?? 0) >= 1
          ? yield* hubApi.edition(hubUrl, session, summary.slug).pipe(Effect.option)
          : Option.none();
      workspaces.push({
        ...(Option.isSome(edition) ? { edition: edition.value } : {}),
        slug: summary.slug,
        name: summary.name,
        role: summary.role,
        allowedDomains: summary.allowedDomains,
        ...(summary.domainClaims === undefined ? {} : { domainClaims: summary.domainClaims }),
        ...(summary.limitedTo === undefined ? {} : { limitedTo: summary.limitedTo }),
        manifest: manifest._tag === "Success" ? manifest.success : (old?.manifest ?? null),
        lastSyncAt:
          manifest._tag === "Success"
            ? DateTime.formatIso(yield* DateTime.now)
            : (old?.lastSyncAt ?? null),
      });
    }
    const syncedAt = DateTime.formatIso(yield* DateTime.now);
    yield* state.updatePersisted((p) => ({
      ...p,
      email: me.success.email,
      workspaces,
      joinable: splitJoinable(me.success, new Set()).joinable,
      domainOffers: splitJoinable(me.success, new Set()).offers,
      removedFrom: me.success.removed ?? [],
      foundings: (me.success.foundings ?? []).filter((founding) => safeId(founding.slug)),
      hubAdmin: me.success.hubAdmin === true,
      lastSyncAt: syncedAt,
    }));
    yield* state.updateRuntime((s) => ({ ...s, syncing: false, error: null, workspaceErrors }));

    // What plugins keep for workspaces and projects that no longer grant it goes away here too.
    yield* announce({ kind: "synced", workspaces });

    for (const workspace of workspaces) {
      const company = workspace.manifest?.knowledge.company;
      if (company !== undefined) yield* background(refreshKnowledge(workspace.slug, company));
    }
    yield* background(work.refresh().pipe(lock.withPermits(1)));
    return yield* publish;
  });

  const startSignIn: PeerWorkspaces["Service"]["startSignIn"] = Effect.fn(
    "PeerWorkspaces.startSignIn",
  )(function* (input) {
    yield* client.startSignIn(input);
    yield* state.updateRuntime((s) => ({ ...s, error: null }));
    return yield* publish;
  }, lock.withPermits(1));

  const finishSignIn: PeerWorkspaces["Service"]["finishSignIn"] = Effect.fn(
    "PeerWorkspaces.finishSignIn",
  )(function* (input) {
    const { persisted } = yield* state.read;
    const signedIn = yield* client.finishSignIn(input);
    yield* announce({ kind: "signed-in" });
    // Only the holder joins automatically. Ambiguous older-Hub matches require confirmation.
    const hubUrl = client.hubUrl(persisted);
    const left = new Set(persisted.leftWorkspaces?.[signedIn.email] ?? []);
    const me = yield* hubApi.me(hubUrl, signedIn.session).pipe(Effect.option);
    for (const workspace of Option.isSome(me) ? splitJoinable(me.value, left).autoJoin : []) {
      yield* hubApi
        .join(hubUrl, signedIn.session, workspace.slug)
        .pipe(Effect.ignoreCause({ log: true }));
    }
    return yield* syncNow;
  }, lock.withPermits(1));

  const signOut: PeerWorkspaces["Service"]["signOut"] = Effect.gen(function* () {
    // What plugins keep at the Hub goes while its session still holds (shared capacity's keys).
    yield* announce({ kind: "signing-out" });
    yield* client.signOut;
    yield* state.updateRuntime((s) => ({
      ...s,
      error: null,
      workspaceErrors: new Map(),
      work: new Map(),
      localThreads: new Map(),
    }));
    return yield* publish;
  }).pipe(lock.withPermits(1));

  const signOutEverywhere = Effect.gen(function* () {
    const { hubUrl, session } = yield* client.session;
    // A refusal leaves both the session and all local providers intact.
    yield* hubApi.signOutEverywhere(hubUrl, session);
    yield* announce({ kind: "signing-out", keysAlreadyQueued: true });
    yield* client.signOut;
    yield* state.updateRuntime((s) => ({
      ...s,
      error: null,
      workspaceErrors: new Map(),
      work: new Map(),
      localThreads: new Map(),
    }));
    return yield* publish;
  }).pipe(lock.withPermits(1));

  const members = (input: PeerHubWorkspaceInput) =>
    Effect.flatMap(client.session, ({ hubUrl, session }) =>
      hubApi.members(hubUrl, session, input.workspace),
    );
  const removalPlan = (input: PeerHubMemberInput) =>
    Effect.flatMap(client.session, ({ hubUrl, session }) =>
      hubApi.removalPlan(hubUrl, session, input),
    );
  const memberKeys = (input: PeerHubMemberInput) =>
    Effect.flatMap(client.session, ({ hubUrl, session }) =>
      hubApi.memberKeys(hubUrl, session, input),
    );
  const changeMember =
    <I extends PeerHubMemberInput>(
      call: (hubUrl: string, session: string, input: I) => Effect.Effect<unknown, PeerHubError>,
    ) =>
    (input: I) =>
      Effect.gen(function* () {
        const { hubUrl, session } = yield* client.session;
        yield* call(hubUrl, session, input);
        return yield* syncNow;
      }).pipe(lock.withPermits(1));

  const createWorkspace: PeerWorkspaces["Service"]["createWorkspace"] = Effect.fn(
    "PeerWorkspaces.createWorkspace",
  )(function* (input) {
    const { hubUrl, session } = yield* client.session;
    const slug = input.slug.toLowerCase();
    yield* hubApi.createWorkspace(hubUrl, session, {
      slug,
      name: input.name,
      allowedDomains: input.allowedDomains.map((domain) => domain.toLowerCase()),
    });
    yield* state.updatePersisted((p) => markLeft(p, p.email, slug, false));
    return yield* syncNow;
  }, lock.withPermits(1));

  const joinWorkspace: PeerWorkspaces["Service"]["joinWorkspace"] = Effect.fn(
    "PeerWorkspaces.joinWorkspace",
  )(function* (input) {
    const { hubUrl, session } = yield* client.session;
    yield* hubApi.join(hubUrl, session, input.workspace, input.confirmDomainMatch);
    yield* state.updatePersisted((p) => markLeft(p, p.email, input.workspace, false));
    return yield* syncNow;
  }, lock.withPermits(1));

  const leaveWorkspace: PeerWorkspaces["Service"]["leaveWorkspace"] = Effect.fn(
    "PeerWorkspaces.leaveWorkspace",
  )(function* (input) {
    const { hubUrl, session } = yield* client.session;
    yield* hubApi.leave(hubUrl, session, input.workspace);
    yield* state.updatePersisted((p) => markLeft(p, p.email, input.workspace, true));
    // The Hub dropped what it kept for this member there; plugins drop their local part.
    yield* announce({ kind: "left-workspace", workspace: input.workspace });
    return yield* syncNow;
  }, lock.withPermits(1));

  const invite: PeerWorkspaces["Service"]["invite"] = Effect.fn("PeerWorkspaces.invite")(
    function* (input) {
      const { hubUrl, session } = yield* client.session;
      const invitation = yield* hubApi.invite(hubUrl, session, input.workspace, {
        email: input.email,
        role: input.role ?? "member",
        ...(input.projects === undefined || input.projects.length === 0
          ? {}
          : { projects: input.projects }),
        ...(input.task === undefined ? {} : { task: input.task }),
      });
      return { ...(yield* publish), ...invitation };
    },
  );

  const onSession =
    <I, A>(call: (hubUrl: string, session: string, input: I) => Effect.Effect<A, PeerHubError>) =>
    (input: I) =>
      Effect.flatMap(client.session, ({ hubUrl, session }) => call(hubUrl, session, input));

  const answerFounding = (action: "accept" | "decline") =>
    Effect.fn(`PeerWorkspaces.${action}Founding`)(function* (input: PeerHubFoundingInput) {
      const { hubUrl, session } = yield* client.session;
      const slug = input.slug.toLowerCase();
      yield* hubApi.answerFounding(hubUrl, session, slug, action);
      if (action === "accept")
        yield* state.updatePersisted((p) => markLeft(p, p.email, slug, false));
      return yield* syncNow;
    }, lock.withPermits(1));

  const findWorkspace: PeerWorkspaces["Service"]["findWorkspace"] = Effect.fn(
    "PeerWorkspaces.findWorkspace",
  )(function* (input) {
    const slug = input.slug.trim().toLowerCase();
    if (!safeId(slug)) return null;
    const { hubUrl, session } = yield* client.session;
    return yield* hubApi.findWorkspace(hubUrl, session, slug);
  });

  const cloneAndRegister = (workspace: PersistedWorkspace, project: PeerProject) =>
    Effect.gen(function* () {
      const settled = (path: string) =>
        state.updateRuntime((s) => {
          const checkouts = new Map(s.checkouts);
          checkouts.delete(path);
          return { ...s, checkouts };
        });
      const failed = (path: string, transient: Transient) =>
        state.updateRuntime((s) => ({
          ...s,
          checkouts: new Map(s.checkouts).set(path, transient),
        }));
      for (const repo of project.repositories) {
        if (!safeId(repo.id)) continue;
        const path = checkoutPath(
          (yield* state.read).persisted,
          workspace.slug,
          project.id,
          repo.id,
        );
        const checkout = yield* Effect.promise(() => checkoutState(path));
        // A jj repository Peer cannot use is never cloned into; its status says why.
        if (checkout.state === "unsupported") continue;
        if (
          checkout.state === "missing" &&
          (!isSafeGitRemote(repo.url) || !isSafeGitRef(repo.branch))
        ) {
          yield* failed(path, {
            state: "error",
            error: "The workspace gives an address git must not clone; ask an admin to fix it.",
          });
          continue;
        }
        if (checkout.state === "missing") {
          yield* state.updateRuntime((s) => ({
            ...s,
            checkouts: new Map(s.checkouts).set(path, { state: "cloning" }),
          }));
          yield* publish;
          const gitHost = PeerPlugins.capability(yield* plugins.contributions, "gitHost");
          const cloned = yield* cloneRepository(repo, path, gitHost).pipe(Effect.result);
          if (cloned._tag === "Failure") {
            const { message, signIn } = cloned.failure;
            yield* failed(path, {
              state: "error",
              error: message,
              ...(signIn ? { gitHubSignIn: true } : {}),
            });
            continue;
          }
        }
        // A checkout already open as a project is not opened a second time.
        const registered = yield* projects
          .getByWorkspaceRoot(path)
          .pipe(Effect.orElseSucceed(() => Option.none()));
        if (Option.isSome(registered)) {
          yield* settled(path);
          continue;
        }
        yield* projects
          .bootstrap({
            commandId: CommandId.make(`peer-open:${NodeCrypto.randomUUID()}`),
            projectId: ProjectId.make(
              `peer-${workspace.slug}-${project.id}-${repo.id}-${NodeCrypto.randomBytes(3).toString("hex")}`,
            ),
            title:
              project.repositories.length === 1 ? project.name : `${project.name} · ${repo.id}`,
            workspaceRoot: path,
          })
          .pipe(
            Effect.tap(() => settled(path)),
            Effect.catch((cause) => failed(path, { state: "error", error: cause.message })),
          );
      }
    });

  // Projects being opened here; a second request for one waits for the first.
  const openings = new Map<string, Deferred.Deferred<void>>();

  const openProject: PeerWorkspaces["Service"]["openProject"] = Effect.fn(
    "PeerWorkspaces.openProject",
  )(function* (input) {
    const { workspace, project } = yield* state.project(input.workspace, input.projectId);
    if (project.repositories.length === 0) {
      return yield* hubError(`${project.name} declares no repositories yet.`);
    }
    // The answer waits for the clone, so the app can open the project or say why it could not.
    // The clone runs in this service's scope: a request that goes away leaves it running.
    const key = projectKey(workspace.slug, project.id);
    let opened = openings.get(key);
    if (opened === undefined) {
      const created = Deferred.makeUnsafe<void>();
      openings.set(key, created);
      opened = created;
      yield* background(
        cloneAndRegister(workspace, project).pipe(
          Effect.ensuring(
            Effect.sync(() => openings.delete(key)).pipe(
              Effect.andThen(Deferred.succeed(created, undefined)),
            ),
          ),
        ),
      );
    }
    yield* Deferred.await(opened);
    return yield* publish;
  });

  const shareProject: PeerWorkspaces["Service"]["shareProject"] = Effect.fn(
    "PeerWorkspaces.shareProject",
  )(function* (input) {
    const { hubUrl, session } = yield* client.session;
    const { persisted } = yield* state.read;
    const workspace = persisted.workspaces.find((w) => w.slug === input.workspace);
    if (workspace === undefined) {
      return yield* hubError(`You are not a member of the workspace "${input.workspace}".`);
    }
    let shared: SharedRepository;
    if (input.repository !== undefined) {
      const gitHost = PeerPlugins.capability(yield* plugins.contributions, "gitHost");
      shared = yield* addressedRepository(input.repository, gitHost);
    } else if (input.projectId !== undefined) {
      const local = yield* projects
        .getById(input.projectId)
        .pipe(Effect.orElseSucceed(() => Option.none()));
      if (Option.isNone(local)) return yield* hubError("That project is not on this computer.");
      shared = yield* localRepository(local.value);
    } else return yield* hubError("Choose a project on this computer or enter a repository.");
    // A second project on one repository splits its tasks and claims; the clone belongs to the first.
    const already = matchRepositories(shared.url, [workspace.manifest])[0];
    if (already !== undefined)
      return yield* new PeerHubError({
        detail: `${withoutCredentials(shared.url)} is already the repository of ${workspace.name}'s project ${already.project}; open that project instead of sharing it again.`,
        refused: true,
      });
    const name = input.name ?? shared.name;
    const id = idFromName(name, "project");
    if (!safeId(id)) return yield* hubError("Give the project a name.");
    const root = shared.root;
    let change = Effect.gen(function* () {
      yield* hubApi.shareProject(hubUrl, session, input.workspace, {
        id,
        name,
        repositories: [{ id: shared.repoId, url: shared.url, branch: shared.branch }],
        areas: input.areas ?? [],
      });
      if (root !== null) {
        // Here the checkout stays where it is; colleagues clone it under their workspace root.
        yield* state.updatePersisted((p) => ({
          ...p,
          localCheckouts: {
            ...p.localCheckouts,
            [`${input.workspace}/${id}/${shared.repoId}`]: root,
          },
        }));
      }
      return yield* syncNow;
    });
    const roots = new Set([
      checkoutPath(persisted, input.workspace, id, shared.repoId),
      ...(root === null ? [] : [root]),
    ]);
    for (const checkout of roots) change = agents.changeCheckout(checkout, change);
    return yield* change;
  }, lock.withPermits(1));

  const unshareProject: PeerWorkspaces["Service"]["unshareProject"] = Effect.fn(
    "PeerWorkspaces.unshareProject",
  )(function* (input) {
    const { hubUrl, session } = yield* client.session;
    const prefix = `${input.workspace}/${input.projectId}/`;
    const { persisted } = yield* state.read;
    const project = persisted.workspaces
      .find((w) => w.slug === input.workspace)
      ?.manifest?.projects.find((p) => p.id === input.projectId);
    const roots = [
      ...new Set([
        ...Object.entries(persisted.localCheckouts ?? {})
          .filter(([key]) => key.startsWith(prefix))
          .map(([, root]) => root),
        ...(project?.repositories ?? []).map((repo) =>
          checkoutPath(persisted, input.workspace, input.projectId, repo.id),
        ),
      ]),
    ];
    let change = Effect.gen(function* () {
      yield* hubApi.unshareProject(hubUrl, session, input.workspace, input.projectId);
      yield* state.updatePersisted((p) => ({
        ...p,
        localCheckouts: Object.fromEntries(
          Object.entries(p.localCheckouts ?? {}).filter(([key]) => !key.startsWith(prefix)),
        ),
      }));
      return yield* syncNow;
    });
    for (const root of roots) change = agents.changeCheckout(root, change);
    return yield* change;
  }, lock.withPermits(1));

  const bindCheckout: PeerWorkspaces["Service"]["bindCheckout"] = Effect.fn(
    "PeerWorkspaces.bindCheckout",
  )(function* (input) {
    const { persisted } = yield* state.read;
    if (!persisted.workspaces.some((workspace) => workspace.slug === input.workspace)) {
      return yield* hubError(`You are not a member of the workspace "${input.workspace}".`);
    }
    if (!safeId(input.projectId) || !safeId(input.repositoryId)) {
      return yield* hubError("That project or repository has no usable id.");
    }
    const local = yield* projects
      .getById(input.localProjectId)
      .pipe(Effect.orElseSucceed(() => Option.none()));
    if (Option.isNone(local)) return yield* hubError("That project is not on this computer.");
    const { title, workspaceRoot: root } = local.value;
    const checkout = yield* Effect.promise(() => checkoutState(root));
    if (checkout.state === "missing") return yield* hubError(`${title} is not a git checkout.`);
    if (checkout.state === "unsupported") return yield* hubError(`${title}: ${checkout.reason}`);
    const previousRoot = checkoutPath(
      persisted,
      input.workspace,
      input.projectId,
      input.repositoryId,
    );
    const change = agents.changeCheckout(
      root,
      Effect.gen(function* () {
        // The latest choice stands, as sharing a project from where it is says too.
        yield* state.updatePersisted((p) => ({
          ...p,
          localCheckouts: {
            ...p.localCheckouts,
            [`${input.workspace}/${input.projectId}/${input.repositoryId}`]: root,
          },
        }));
        return yield* publish;
      }),
    );
    return yield* previousRoot === root ? change : agents.changeCheckout(previousRoot, change);
  }, lock.withPermits(1));

  return PeerWorkspaces.of({
    startSignIn,
    finishSignIn,
    signOut,
    signOutEverywhere,
    members,
    removalPlan,
    memberKeys,
    removeMember: changeMember(hubApi.removeMember),
    setMemberRole: changeMember(hubApi.setMemberRole),
    setMemberProjects: changeMember(hubApi.setMemberProjects),
    withdrawInvite: changeMember(hubApi.withdrawInvite),
    revokeMemberKeys: changeMember(hubApi.revokeMemberKeys),
    sync: syncNow.pipe(lock.withPermits(1)),
    createWorkspace,
    joinWorkspace,
    leaveWorkspace,
    invite,
    invitations: onSession((hubUrl, session, input: PeerHubWorkspaceInput) =>
      hubApi.invitations(hubUrl, session, input.workspace),
    ),
    invitePreview: onSession(hubApi.invitePreview),
    resendInvite: onSession(hubApi.resendInvite),
    acceptFounding: answerFounding("accept"),
    declineFounding: answerFounding("decline"),
    findWorkspace,
    openProject,
    shareProject,
    unshareProject,
    bindCheckout,
  });
});

export const layer = Layer.effect(PeerWorkspaces, make);
