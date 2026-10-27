import type { NeedsYouItem } from "@t3tools/client-runtime/peer/needs-you";
import {
  ALL_PROJECTS,
  projectScopeKey,
  taskCards,
  type WorkProjectNode,
} from "@t3tools/client-runtime/peer/work";
import type { ReactNode } from "react";

import type { CommandPaletteActionItem } from "../CommandPalette.logic";

export function taskSearchItems(input: {
  readonly tree: ReadonlyArray<WorkProjectNode>;
  readonly needs: ReadonlyArray<NeedsYouItem>;
  readonly me: string | null;
  readonly scope: string;
  readonly searchScope?: string;
  readonly icon: ReactNode;
  readonly open: (target: { workspace: string; project: string; task: string }) => Promise<void>;
}): CommandPaletteActionItem[] {
  return taskCards(input.tree, {
    scope: input.searchScope ?? ALL_PROJECTS,
    mine: false,
    query: "",
    needs: input.needs,
    me: input.me,
  }).flatMap((card) =>
    card.kind !== "task"
      ? []
      : [
          {
            kind: "action" as const,
            value: `task:${card.project.workspace}:${card.project.projectId}:${card.task.id}`,
            title: card.task.title,
            description: `Task · ${card.project.workspaceName} / ${card.project.name} · ${card.state.label}`,
            searchTerms: [
              card.task.title,
              card.task.key ?? "",
              card.task.id,
              card.project.name,
              card.project.workspaceName,
            ],
            searchPriority: projectScopeKey(card.project) === input.scope ? 1 : 0,
            icon: input.icon,
            run: () =>
              input.open({
                workspace: card.project.workspace,
                project: card.project.projectId,
                task: card.task.id,
              }),
          },
        ],
  );
}
