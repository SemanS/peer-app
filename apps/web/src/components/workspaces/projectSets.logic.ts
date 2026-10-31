/**
 * Projects a person works on together, shown under one name as a "workspace". This is this
 * computer's view of projects, not the Hub's workspace (`PeerWorkspaceState`), which is a company's
 * membership: nothing here reaches the Hub or anyone else, so the code calls it a project set.
 */
export interface ProjectSet {
  readonly id: string;
  readonly name: string;
  /** The project scopes it holds, in the order their columns show. */
  readonly projects: ReadonlyArray<string>;
}

/** A project set is scoped as `set:<id>`, beside a workspace project's and a local project's key. */
export const SET_SCOPE_PREFIX = "set:";

export const setScope = (id: string): string => `${SET_SCOPE_PREFIX}${id}`;

export const isSetScope = (scope: string): boolean => scope.startsWith(SET_SCOPE_PREFIX);

export const setOfScope = (
  scope: string,
  sets: ReadonlyArray<ProjectSet>,
): ProjectSet | undefined =>
  isSetScope(scope)
    ? sets.find((set) => set.id === scope.slice(SET_SCOPE_PREFIX.length))
    : undefined;

/** Whether picking a project in the set's scope stays in the set rather than leaving it. */
export const setHolds = (
  stored: string,
  project: string | undefined,
  sets: ReadonlyArray<ProjectSet>,
): boolean =>
  project !== undefined && setOfScope(stored, sets)?.projects.includes(project) === true;

/** The set a project belongs to, for its pages: the one in scope, else the first that holds it. */
export const setOfProject = (
  project: string,
  stored: string,
  sets: ReadonlyArray<ProjectSet>,
): ProjectSet | undefined =>
  setHolds(stored, project, sets)
    ? setOfScope(stored, sets)
    : sets.find((set) => set.projects.includes(project));

/** Not `crypto.randomUUID`: a remote browser on plain http has none. */
export const newSetId = (): string =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Two projects grouped for the first time, named after both until the person renames them. */
export function joinProjects(
  sets: ReadonlyArray<ProjectSet>,
  id: string,
  first: { readonly scope: string; readonly name: string },
  second: { readonly scope: string; readonly name: string },
): ReadonlyArray<ProjectSet> {
  return [
    ...sets,
    { id, name: `${first.name} + ${second.name}`, projects: [first.scope, second.scope] },
  ];
}

export function addToSet(
  sets: ReadonlyArray<ProjectSet>,
  id: string,
  project: string,
): ReadonlyArray<ProjectSet> {
  return sets.map((set) =>
    set.id !== id || set.projects.includes(project)
      ? set
      : { ...set, projects: [...set.projects, project] },
  );
}

/** A blank name keeps the old one: a set always has something to show on the project button. */
export function renameSet(
  sets: ReadonlyArray<ProjectSet>,
  id: string,
  name: string,
): ReadonlyArray<ProjectSet> {
  const trimmed = name.trim();
  if (trimmed === "") return sets;
  return sets.map((set) => (set.id === id ? { ...set, name: trimmed } : set));
}

export function dissolveSet(
  sets: ReadonlyArray<ProjectSet>,
  id: string,
): ReadonlyArray<ProjectSet> {
  return sets.filter((set) => set.id !== id);
}

/**
 * A project out of its set. One project alone is no set any more, so the set goes and `scope` names
 * the project left, for the button to follow.
 */
export function removeFromSet(
  sets: ReadonlyArray<ProjectSet>,
  id: string,
  project: string,
): { readonly sets: ReadonlyArray<ProjectSet>; readonly scope: string | undefined } {
  const set = sets.find((candidate) => candidate.id === id);
  if (set === undefined) return { sets, scope: undefined };
  const projects = set.projects.filter((candidate) => candidate !== project);
  if (projects.length >= 2) {
    return {
      sets: sets.map((candidate) => (candidate.id === id ? { ...set, projects } : candidate)),
      scope: setScope(id),
    };
  }
  return { sets: dissolveSet(sets, id), scope: projects[0] };
}

/** The project's checkout on this computer, as the sidebar's catalog holds it. */
export interface ProjectCheckoutRef {
  readonly environmentId: string;
  readonly cwd: string;
}

/**
 * Where a set's project is open, preferring this computer: a column reads files and diffs there,
 * and a project with no checkout has none to show.
 */
export function checkoutOf(
  refs: ReadonlyArray<{ readonly environmentId: string; readonly projectId: string }>,
  catalog: ReadonlyArray<{
    readonly environmentId: string;
    readonly id: string;
    readonly workspaceRoot: string;
  }>,
  primaryEnvironmentId: string | null,
): ProjectCheckoutRef | null {
  const held = refs.flatMap((ref) =>
    catalog.filter(
      (project) => project.environmentId === ref.environmentId && project.id === ref.projectId,
    ),
  );
  const found =
    held.find((project) => project.environmentId === primaryEnvironmentId) ?? held[0] ?? null;
  return found === null ? null : { environmentId: found.environmentId, cwd: found.workspaceRoot };
}

/**
 * A set's projects no Hub workspace shares, with where they are: a shared room's agent has no room
 * in them, so it gets their folders. `groups` is the sidebar's catalog.
 */
export function setFolders(
  set: ProjectSet | undefined,
  groups: ReadonlyArray<{
    readonly projectKey: string;
    readonly displayName: string;
    readonly workspaceRoot: string;
  }>,
): ReadonlyArray<{ readonly name: string; readonly folder: string }> {
  return (set?.projects ?? []).flatMap((scope) => {
    const group = groups.find((candidate) => `local:${candidate.projectKey}` === scope);
    return group === undefined ? [] : [{ name: group.displayName, folder: group.workspaceRoot }];
  });
}
