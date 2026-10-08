import {
  isScratchProject,
  normalizeProjectPathForComparison,
} from "@t3tools/client-runtime/state/projects";

export function selectLocalProjects<
  Project extends {
    readonly id: string;
    readonly environmentId: string;
    readonly workspaceRoot: string;
    readonly title: string;
  },
>(
  projects: ReadonlyArray<Project>,
  environmentId: string | null,
  scratchRoot: string | null,
  sharedProjectIds: ReadonlySet<string>,
): Array<Project> {
  const roots = new Set(
    projects
      .filter(
        (project) => project.environmentId === environmentId && sharedProjectIds.has(project.id),
      )
      .map((project) => normalizeProjectPathForComparison(project.workspaceRoot)),
  );
  return projects
    .filter((project) => {
      if (
        project.environmentId !== environmentId ||
        sharedProjectIds.has(project.id) ||
        isScratchProject(project, scratchRoot)
      )
        return false;
      const root = normalizeProjectPathForComparison(project.workspaceRoot);
      if (roots.has(root)) return false;
      roots.add(root);
      return true;
    })
    .toSorted((first, second) => first.title.localeCompare(second.title));
}
