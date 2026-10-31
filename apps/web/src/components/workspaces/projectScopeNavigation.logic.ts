import { setScope } from "./projectSets.logic";
import { ALL_PROJECTS } from "./workBoard.logic";
import {
  scopeOfProject,
  type ProjectCatalog,
  type ResolvedProjectScope,
} from "./projectScope.logic";

export function scopeForLocation(
  pathname: string,
  params: Readonly<Record<string, string | undefined>>,
  search: Readonly<Record<string, unknown>>,
  catalog: ProjectCatalog,
): string | undefined {
  if (params.setId) return setScope(params.setId);
  if (params.workspace && params.project) return `${params.workspace}/${params.project}`;
  if (pathname === "/work" && typeof search.scope === "string") return search.scope;
  if (pathname !== "/pull-requests") return undefined;
  if (typeof search.projectId !== "string") return ALL_PROJECTS;
  const refs = catalog.groups
    .flatMap((group) => group.memberProjectRefs)
    .filter(
      (ref) =>
        ref.projectId === search.projectId &&
        (search.environmentId === undefined || ref.environmentId === search.environmentId),
    );
  const ref = refs[0];
  if (ref === undefined || refs.some((other) => other.environmentId !== ref.environmentId)) {
    return undefined;
  }
  return scopeOfProject(ref, catalog)?.scope;
}

/** A project switch leaves task/chat details behind; PR lists keep only project-independent filters. */
export function locationForProjectScope(
  pathname: string,
  search: Readonly<Record<string, unknown>>,
  scope: ResolvedProjectScope,
) {
  if (pathname === "/pull-requests" && (scope.refs === null || scope.refs.length === 1)) {
    return pullRequestsLocation(search, scope);
  }
  return {
    to: "/work" as const,
    search: {
      scope: scope.scope,
      ...(pathname === "/work" && search.view === "needs-you"
        ? { view: "needs-you" as const }
        : {}),
    },
  };
}

/** PR entry points use the project's first checkout; without one, the page explicitly shows All projects. */
export function pullRequestsLocation(
  search: Readonly<Record<string, unknown>>,
  scope: ResolvedProjectScope,
) {
  const ref = scope.refs?.[0];
  return {
    to: "/pull-requests" as const,
    search: {
      involvement:
        search.involvement === "authored" || search.involvement === "reviewing"
          ? search.involvement
          : ("all" as const),
      state:
        search.state === "closed" || search.state === "merged" || search.state === "all"
          ? search.state
          : ("open" as const),
      ...(ref === undefined ? {} : { environmentId: ref.environmentId, projectId: ref.projectId }),
    } as const,
  };
}
