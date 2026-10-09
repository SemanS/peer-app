import { useState } from "react";
import {
  blockedBy,
  blockedLabel,
  dependenciesOf,
  dependencyName,
  projectDependencyIndex,
  stateWord,
} from "./dependencies.logic";
import type { TaskSlotProps } from "../slots.types";
import { Badge } from "../../ui/badge";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../../ui/tooltip";
export function BlockedBy({ status, workspace, project, task }: TaskSlotProps) {
  const [open, setOpen] = useState(false);
  if (!project) return null;
  const snapshot = status.dependencies?.find((s) => s.workspace === workspace),
    index = projectDependencyIndex(project),
    blocked = blockedBy(snapshot, project.project.id, task.id, index),
    label = blockedLabel(blocked);
  if (!label) return null;
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            onClick={(event) => {
              event.stopPropagation();
              setOpen((v) => !v);
            }}
          >
            <Badge variant="warning" size="sm">
              {label}
            </Badge>
          </button>
        }
      />
      <TooltipPopup>
        {dependenciesOf(snapshot, project.project.id, task.id, index).map(
          ({ task: dependency, state }) => (
            <div key={dependency.id}>
              {dependencyName(dependency)} · {stateWord(state)}
            </div>
          ),
        )}
      </TooltipPopup>
    </Tooltip>
  );
}
