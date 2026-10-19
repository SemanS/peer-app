import type { NeedsYouItem } from "@t3tools/client-runtime/peer/needs-you";
import type {
  EnvironmentId,
  PeerHubStatus,
  ProjectId,
  PeerProjectState,
  PeerWorkspaceRole,
  PeerWorkspaceState,
} from "@t3tools/contracts";

import { getLocalFileManagerName } from "../../lib/utils";
import { pathRulesText, projectPolicyLine } from "./DecisionChip.logic";
import {
  isLocalScope,
  LOCAL_SCOPE_PREFIX,
  localScope,
  type ResolvedProjectScope,
} from "./projectScope.logic";
import {
  activeTaskCount,
  activeTasksText,
  needsYouText,
  sidebarNeedsCount,
} from "./sidebarNav.logic";
import { DEFAULT_PROJECT_TAB, type PeerSettingsLocation } from "./settings/peerSettings.logic";
import { ALL_PROJECTS, projectScopeKey } from "./workBoard.logic";
import { canRemoveProject } from "./workMenus.logic";
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

/** The menu's coordination row: the policy that applies in the project, who set it, and where to change it. */
export interface CoordinationRow {
  /** "Coordination: notify". */
  readonly title: string;
  /** "Your default on this computer · 2 path rules", "Set by the project". */
  readonly detail: string;
  readonly action: {
    readonly label: "Change…" | "Settings";
    readonly location: PeerSettingsLocation;
  };
}

/** What the menu offers on the project in scope, under the list of projects. */
export type ProjectMenuActions =
  | {
      readonly kind: "workspace";
      readonly name: string;
      readonly workspace: string;
      readonly workspaceName: string;
      readonly projectId: string;
      /** Absent while coordination is off on this computer or the Hub's policies are not known. */
      readonly coordination: CoordinationRow | null;
      /** Project settings: the project's page in Settings → Peer. */
      readonly settings: PeerSettingsLocation;
      /** Open folder: where the project is checked out here; absent until a repository is. */
      readonly folder: string | undefined;
      /** Remove from workspace…: whoever shared it from Peer, and the workspace's owner or admins. */
      readonly remove: boolean;
    }
  | {
      readonly kind: "local";
      readonly name: string;
      readonly projectKey: string;
      readonly folder: string;
      /** Share with a workspace: the project on this computer that the workspace gets. */
      readonly project: { readonly id: ProjectId; readonly environmentId: EnvironmentId };
    };

/**
 * The menu's actions on a workspace project. The coordination row names the policy that applies and
 * who set it, with a Settings button when the project decides and a Change… button when this
 * computer's default does; Remove from workspace… is for those who may take the project out.
 */
export function workspaceProjectActions(input: {
  readonly status: Pick<PeerHubStatus, "coordination" | "resources" | "email">;
  readonly workspace: {
    readonly slug: string;
    readonly name: string;
    readonly role: PeerWorkspaceRole;
  };
  readonly state: Pick<PeerProjectState, "project" | "repositories">;
}): ProjectMenuActions {
  const { status, workspace, state } = input;
  const { project } = state;
  const line = projectPolicyLine(status, workspace.slug, { id: project.id, name: project.name });
  const fromProject = line?.change.page === "project";
  return {
    kind: "workspace",
    name: project.name,
    workspace: workspace.slug,
    workspaceName: workspace.name,
    projectId: project.id,
    coordination:
      line === null
        ? null
        : {
            title: `Coordination: ${line.chip.policy}`,
            detail: [
              fromProject ? "Set by the project" : "Your default on this computer",
              line.rules === 0 ? undefined : pathRulesText(line.rules),
            ]
              .filter((part) => part !== undefined)
              .join(" · "),
            action: fromProject
              ? {
                  label: "Settings",
                  location: {
                    kind: "project",
                    workspace: workspace.slug,
                    projectId: project.id,
                    tab: "coordination",
                  },
                }
              : {
                  label: "Change…",
                  location: { kind: "computer", section: "coordination" },
                },
          },
    settings: {
      kind: "project",
      workspace: workspace.slug,
      projectId: project.id,
      tab: DEFAULT_PROJECT_TAB,
    },
    folder: state.repositories.find((repository) => repository.state === "ready")?.path,
    remove: canRemoveProject({
      project,
      workspaceRole: workspace.role,
      email: status.email,
    }),
  };
}

/** The menu's actions on a project of this computer that no workspace shares. */
export function localProjectActions(group: LocalGroup): ProjectMenuActions {
  return {
    kind: "local",
    name: group.displayName,
    projectKey: group.projectKey,
    folder: group.workspaceRoot,
    project: { id: group.id, environmentId: group.environmentId },
  };
}

type LocalGroup = {
  readonly id: ProjectId;
  readonly environmentId: EnvironmentId;
  readonly projectKey: string;
  readonly displayName: string;
  readonly workspaceRoot: string;
};

/**
 * "Open folder in Finder": the file manager is named as the environment reveals files in it
 * ("Reveal in File Explorer"), else as this computer's platform calls it.
 */
export function openFolderLabel(revealLabel: string | undefined, platform: string): string {
  const named = revealLabel?.replace(/^Reveal in /u, "");
  return `Open folder in ${named === undefined || named === "" ? getLocalFileManagerName(platform) : named}`;
}

/**
 * The menu's actions on the project a scope names: a workspace project's, a local project's, or
 * none for all projects and for a project that is gone.
 */
export function actionsForScope(
  scope: string,
  known: {
    readonly status:
      | (Pick<PeerHubStatus, "coordination" | "resources" | "email"> & {
          readonly workspaces: ReadonlyArray<
            Pick<PeerWorkspaceState, "slug" | "name" | "role" | "projects">
          >;
        })
      | null;
    readonly groups: ReadonlyArray<LocalGroup>;
  },
): ProjectMenuActions | null {
  if (scope === ALL_PROJECTS) return null;
  if (isLocalScope(scope)) {
    const key = scope.slice(LOCAL_SCOPE_PREFIX.length);
    const group = known.groups.find((candidate) => candidate.projectKey === key);
    return group === undefined ? null : localProjectActions(group);
  }
  for (const workspace of known.status?.workspaces ?? []) {
    for (const state of workspace.projects) {
      if (projectScopeKey({ workspace: workspace.slug, projectId: state.project.id }) === scope) {
        return workspaceProjectActions({ status: known.status!, workspace, state });
      }
    }
  }
  return null;
}
