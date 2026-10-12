import type { NeedsYouItem } from "@t3tools/client-runtime/peer/needs-you";

import { isLocalScope, localScope, type ResolvedProjectScope } from "./projectScope.logic";
import {
  activeTaskCount,
  activeTasksText,
  needsYouText,
  sidebarNeedsCount,
} from "./sidebarNav.logic";
import { ALL_PROJECTS, projectScopeKey } from "./workBoard.logic";
import type { WorkProjectNode } from "./workTree.logic";

/** The last part of a path: the folder a checkout lives in. */
export function folderName(path: string): string | undefined {
  return path.split(/[\\/]/u).findLast((part) => part !== "");
}

/** One project in the menu: what it is called, its folder under it, and what its tasks add up to. */
export interface ProjectMenuRow {
  /** The scope choosing it sets. */
  readonly scope: string;
  readonly name: string;
  /** The folder it lives in, in code type under the name. */
  readonly folder: string | undefined;
  /** "7 active"; absent for none. */
  readonly active: string | undefined;
  /** "1 needs you"; absent for none. */
  readonly needs: string | undefined;
}

export interface ProjectMenuSection {
  readonly id: string;
  /** "Webinson · projects", "Local projects". */
  readonly heading: string;
  readonly rows: ReadonlyArray<ProjectMenuRow>;
}

/** The part of a workspace the menu lists. */
interface MenuWorkspace {
  readonly slug: string;
  readonly name: string;
  readonly projects: ReadonlyArray<{
    readonly project: { readonly id: string; readonly name: string };
    readonly repositories: ReadonlyArray<{ readonly path: string }>;
  }>;
}

/**
 * The projects the menu offers, section by section: each workspace's projects (with the folder of
 * their checkout and how many tasks are active and wait on the person), then the projects of this
 * computer that no workspace shares. A project the work tree does not know yet has no counts.
 */
export function projectMenuSections(input: {
  readonly workspaces: ReadonlyArray<MenuWorkspace>;
  readonly tree: ReadonlyArray<WorkProjectNode>;
  readonly needs: ReadonlyArray<NeedsYouItem>;
  readonly locals: ReadonlyArray<{
    readonly projectKey: string;
    readonly displayName: string;
    readonly workspaceRoot: string;
  }>;
}): ReadonlyArray<ProjectMenuSection> {
  const nodes = new Map(input.tree.map((node) => [projectScopeKey(node), node] as const));
  const sections: ProjectMenuSection[] = input.workspaces
    .filter((workspace) => workspace.projects.length > 0)
    .map((workspace) => ({
      id: workspace.slug,
      heading: `${workspace.name} · projects`,
      rows: workspace.projects.map((state) => {
        const scope = projectScopeKey({ workspace: workspace.slug, projectId: state.project.id });
        const node = nodes.get(scope);
        return {
          scope,
          name: state.project.name,
          folder: folderName(state.repositories[0]?.path ?? "") ?? state.project.id,
          active: node === undefined ? undefined : activeTasksText(activeTaskCount(node)),
          needs:
            node === undefined ? undefined : needsYouText(sidebarNeedsCount([node], input.needs)),
        };
      }),
    }));
  if (input.locals.length > 0) {
    sections.push({
      id: "local",
      heading: "Local projects",
      rows: input.locals.map((local) => ({
        scope: localScope(local.projectKey),
        name: local.displayName,
        folder: folderName(local.workspaceRoot),
        active: undefined,
        needs: undefined,
      })),
    });
  }
  return sections;
}

/** The project button's two lines: where the project is, and its name. */
export function projectButtonLines(
  scope: Pick<ResolvedProjectScope, "scope" | "name">,
  workspaces: ReadonlyArray<{ readonly slug: string; readonly name: string }>,
): { readonly where: string; readonly name: string } {
  if (scope.name === undefined || scope.scope === ALL_PROJECTS) {
    return {
      where:
        workspaces.length === 0
          ? "This computer"
          : workspaces.length === 1
            ? (workspaces[0]?.name ?? "")
            : `${workspaces.length} workspaces`,
      name: "All projects",
    };
  }
  if (isLocalScope(scope.scope)) return { where: "This computer", name: scope.name };
  const slug = scope.scope.split("/")[0];
  return {
    where: workspaces.find((workspace) => workspace.slug === slug)?.name ?? "Workspace",
    name: scope.name,
  };
}
