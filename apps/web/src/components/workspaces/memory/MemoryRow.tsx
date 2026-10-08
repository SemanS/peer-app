import { useNavigate } from "@tanstack/react-router";
import { LightbulbIcon } from "lucide-react";

import type { ProjectSlotProps } from "../slots";

/** Shared findings, evidence, questions, and review remain reachable even when no candidates wait. */
export function MemoryRow({ project }: ProjectSlotProps) {
  const navigate = useNavigate();
  const { workspace, projectId } = project;
  return (
    <button
      type="button"
      className="flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-2 text-left text-xs text-muted-foreground hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() =>
        void navigate({
          to: "/memory/$workspace/$project",
          params: { workspace, project: projectId },
          search: {},
        })
      }
    >
      <LightbulbIcon aria-hidden className="size-3.5 shrink-0" />
      <span className="truncate font-medium text-sidebar-foreground">Memory</span>
    </button>
  );
}
