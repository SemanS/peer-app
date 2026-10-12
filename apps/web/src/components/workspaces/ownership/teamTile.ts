import { decisionsWaitingOn } from "@t3tools/client-runtime/peer/ownership";
import { UsersIcon } from "lucide-react";

import type { ProjectSignal } from "../slots.types";
import type { WorkProjectNode } from "../workTree.logic";
import { openTeam } from "./teamNavigation";

/**
 * The Team tile among a project's signals: it opens the Team page, and counts the decisions that
 * wait on the person (owner's calls to them, and reviews that ask them), or says nothing of a count
 * while none wait: the tile stays, like Memory's, since the page is worth opening without one.
 * There is no tile while ownership is not known for the project, as before the plugin.
 */
export function teamSignals(project: WorkProjectNode, now: number): ReadonlyArray<ProjectSignal> {
  if (project.ownership === undefined) return [];
  const waiting = decisionsWaitingOn(project, now);
  return [
    {
      id: "team",
      label: "Team",
      icon: UsersIcon,
      count: waiting > 0 ? waiting : null,
      detail:
        waiting === 0
          ? "Who owns what"
          : waiting === 1
            ? "1 decision waits on you"
            : `${waiting} decisions wait on you`,
      tone: "team",
      chip: (count) => `${count} to decide`,
      open: (navigate) =>
        openTeam(navigate, { workspace: project.workspace, project: project.projectId }),
    },
  ];
}
