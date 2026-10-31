import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  EnvironmentId,
  type PeerHubStatus,
  type ProjectId,
  type ScopedProjectRef,
} from "@t3tools/contracts";

import { ALL_PROJECTS, projectScopeKey } from "./workBoard.logic";

/**
 * A workspace project as the sidebar's project scope knows it: its scope key, its name, and the
 * projects of this computer that hold its repositories, whose chats belong to it.
 */
export interface PeerProjectEntry {
  /** `<workspace>/<project>`, the key the Work views share (`peer:work-scope`). */
  readonly scope: string;
  readonly name: string;
  readonly refs: ReadonlyArray<ScopedProjectRef>;
}

/**
 * Every workspace project of the Hub's status, with where its repositories are open on this
 * computer. A repository not cloned yet has no project here, so a project with none has no chats.
 */
export function peerProjectIndex(
  status: Pick<PeerHubStatus, "environmentId" | "workspaces"> | null,
): ReadonlyArray<PeerProjectEntry> {
  if (status === null) return [];
  const environmentId =
    status.environmentId.trim() === "" ? null : EnvironmentId.make(status.environmentId);
  return status.workspaces.flatMap((workspace) =>
    workspace.projects.map((state): PeerProjectEntry => ({
      scope: projectScopeKey({ workspace: workspace.slug, projectId: state.project.id }),
      name: state.project.name,
      refs: state.repositories.flatMap((repository) =>
        environmentId === null || repository.projectId === undefined
          ? []
          : [{ environmentId, projectId: repository.projectId }],
      ),
    })),
  );
}

/** A project of this computer that no workspace shares is scoped as `local:<its project key>`. */
export const LOCAL_SCOPE_PREFIX = "local:";

export const localScope = (projectKey: string): string => `${LOCAL_SCOPE_PREFIX}${projectKey}`;

export const isLocalScope = (scope: string): boolean => scope.startsWith(LOCAL_SCOPE_PREFIX);

/** A project of the sidebar's catalog: a repository, as one or several computers hold it. */
export interface ScopeGroup {
  readonly projectKey: string;
  readonly displayName: string;
  readonly memberProjectRefs: ReadonlyArray<ScopedProjectRef>;
}

/** What the scope can be resolved against. */
export interface ProjectCatalog {
  readonly peer: ReadonlyArray<PeerProjectEntry>;
  readonly groups: ReadonlyArray<ScopeGroup>;
}

/** The scope in force, once checked against the projects there are. */
export interface ResolvedProjectScope {
  /** `all`, a workspace project's key, or a local project's. */
  readonly scope: string;
  /** The project's name; undefined for all projects. */
  readonly name: string | undefined;
  /** The projects whose chats it shows; null for every project. */
  readonly refs: ReadonlyArray<ScopedProjectRef> | null;
}

const EVERY_PROJECT: ResolvedProjectScope = { scope: ALL_PROJECTS, name: undefined, refs: null };

/** How the thread list names a project: `<environment>:<project>`. */
const projectRefKey = (ref: ScopedProjectRef): string => `${ref.environmentId}:${ref.projectId}`;

/**
 * The chosen scope against the projects there are: the project it names, with the projects of this
 * computer whose chats belong to it, or every project when it names none (a project removed from
 * the workspace, or not reported yet). The Tasks and Chats views share this one answer.
 */
export function resolveProjectScope(stored: string, known: ProjectCatalog): ResolvedProjectScope {
  if (stored === ALL_PROJECTS) return EVERY_PROJECT;
  if (isLocalScope(stored)) {
    const key = stored.slice(LOCAL_SCOPE_PREFIX.length);
    const group = known.groups.find((candidate) => candidate.projectKey === key);
    if (group === undefined) return EVERY_PROJECT;
    // A local project someone shared since is its workspace project now: the choice follows it.
    const keys = new Set(group.memberProjectRefs.map(projectRefKey));
    const moved = known.peer.find((entry) =>
      entry.refs.some((ref) => keys.has(projectRefKey(ref))),
    );
    return moved === undefined
      ? { scope: stored, name: group.displayName, refs: group.memberProjectRefs }
      : { scope: moved.scope, name: moved.name, refs: moved.refs };
  }
  const project = known.peer.find((entry) => entry.scope === stored);
  return project === undefined
    ? EVERY_PROJECT
    : { scope: stored, name: project.name, refs: project.refs };
}

/** The projects the Chats list keeps, for `filterSidebarV2VisibleThreads`; null keeps every project. */
export function chatScopeKeys(refs: ResolvedProjectScope["refs"]): ReadonlySet<string> | null {
  return refs === null ? null : new Set(refs.map(projectRefKey));
}

export function latestScopedChat<
  Thread extends {
    readonly environmentId: EnvironmentId;
    readonly projectId: ScopedProjectRef["projectId"];
    readonly updatedAt: string;
    readonly archivedAt: string | null;
    readonly lineage: { readonly relationshipToParent: string | null };
  },
>(threads: ReadonlyArray<Thread>, refs: ResolvedProjectScope["refs"]): Thread | null {
  const keys = chatScopeKeys(refs);
  return threads
    .filter(
      (thread) =>
        thread.archivedAt === null &&
        thread.lineage.relationshipToParent !== "subagent" &&
        (keys === null || keys.has(projectRefKey(thread))),
    )
    .reduce<Thread | null>(
      (latest, thread) =>
        latest === null || Date.parse(thread.updatedAt) > Date.parse(latest.updatedAt)
          ? thread
          : latest,
      null,
    );
}

/** Where a new chat in the scope starts: the project on this computer if it has one, else the first. */
export function newChatProject(
  resolved: ResolvedProjectScope,
  primaryEnvironmentId: string | null,
): ScopedProjectRef | null {
  const refs = resolved.refs ?? [];
  return refs.find((ref) => ref.environmentId === primaryEnvironmentId) ?? refs[0] ?? null;
}

/**
 * The project the first screen opens, as the sidebar's + would: the scoped project, else with every
 * project in scope the latest on a Hub, where a new chat has its room, else the latest there is.
 */
export function landingProject(
  scope: ResolvedProjectScope,
  primaryEnvironmentId: string | null,
  recent: ReadonlyArray<{ readonly environmentId: EnvironmentId; readonly id: ProjectId }>,
  peer: ReadonlyArray<Pick<PeerProjectEntry, "refs">>,
): ScopedProjectRef | null {
  const refs = recent.map((project) => scopeProjectRef(project.environmentId, project.id));
  const known = new Set(refs.map(projectRefKey));
  const scoped = newChatProject(scope, primaryEnvironmentId);
  if (scoped !== null && known.has(projectRefKey(scoped))) return scoped;
  const shared = new Set(peer.flatMap((entry) => entry.refs.map(projectRefKey)));
  return refs.find((ref) => shared.has(projectRefKey(ref))) ?? refs[0] ?? null;
}

/**
 * The scope that shows a project's chats and tasks, for "filter by project" on a chat: its
 * workspace project when a workspace holds it, else its local project.
 */
export function scopeOfProject(
  ref: ScopedProjectRef,
  known: ProjectCatalog,
): { readonly scope: string; readonly name: string } | null {
  const key = projectRefKey(ref);
  const peer = known.peer.find((entry) => entry.refs.some((held) => projectRefKey(held) === key));
  if (peer !== undefined) return { scope: peer.scope, name: peer.name };
  const group = known.groups.find((candidate) =>
    candidate.memberProjectRefs.some((member) => projectRefKey(member) === key),
  );
  return group === undefined
    ? null
    : { scope: localScope(group.projectKey), name: group.displayName };
}

/** The catalog's projects that no workspace shares: what the project menu lists after the workspaces'. */
export function localProjectGroups<Group extends ScopeGroup>(
  groups: ReadonlyArray<Group>,
  peer: ReadonlyArray<PeerProjectEntry>,
): ReadonlyArray<Group> {
  const shared = new Set(peer.flatMap((entry) => entry.refs.map(projectRefKey)));
  return groups.filter(
    (group) => !group.memberProjectRefs.some((ref) => shared.has(projectRefKey(ref))),
  );
}
