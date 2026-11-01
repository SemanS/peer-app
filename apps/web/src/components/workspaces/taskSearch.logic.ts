import {
  ALL_PROJECTS,
  inScope,
  projectScopeKey,
  taskState,
  type WorkProjectNode,
} from "@t3tools/client-runtime/peer/work";
import type { ReactNode } from "react";

import type { CommandPaletteActionItem } from "../CommandPalette.logic";

export function taskSearchItems(input: {
  readonly tree: ReadonlyArray<WorkProjectNode>;
  readonly scope: string;
  readonly searchScope?: string;
  readonly icon: ReactNode;
  readonly open: (target: { workspace: string; project: string; task: string }) => Promise<void>;
}): CommandPaletteActionItem[] {
  const searched = input.searchScope ?? ALL_PROJECTS;
  const rows = input.tree
    .filter((project) => inScope(searched, project))
    .flatMap((project) =>
      project.areas.flatMap((area) => area.tasks.map((task) => ({ project, task }))),
    );
  // The project in scope comes first, and what is done last, for a search that matches both alike.
  const rank = ({ project, task }: (typeof rows)[number]) =>
    (projectScopeKey(project) === input.scope ? 0 : 1) + (task.done ? 2 : 0);
  return rows
    .toSorted((a, b) => rank(a) - rank(b))
    .map(({ project, task }) => ({
      kind: "action" as const,
      value: `task:${project.workspace}:${project.projectId}:${task.id}`,
      title: task.title,
      description: `Task · ${project.workspaceName} / ${project.name} · ${taskState(task).label}`,
      searchTerms: [task.title, task.key ?? "", task.id, project.name, project.workspaceName],
      icon: input.icon,
      run: () =>
        input.open({ workspace: project.workspace, project: project.projectId, task: task.id }),
    }));
}
