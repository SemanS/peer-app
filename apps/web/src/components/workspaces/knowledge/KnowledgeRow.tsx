import { useNavigate } from "@tanstack/react-router";
import { LightbulbIcon } from "lucide-react";

import { cn } from "../../../lib/utils";
import type { ProjectSlotProps } from "../slots";

/** What agents found that the project may want to keep, waiting for people to decide. */
export function KnowledgeRow({ project, activeThread }: ProjectSlotProps) {
  const navigate = useNavigate();
  const { workspace, projectId, candidates } = project;
  if (candidates === 0) return null;
  const active = activeThread === `knowledge:${workspace}:${projectId}`;
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-2 text-left text-xs text-muted-foreground",
        active ? "bg-sidebar-row-active" : "hover:bg-sidebar-row-hover",
      )}
      onClick={() =>
        void navigate({
          to: "/knowledge/$workspace/$project",
          params: { workspace, project: projectId },
        })
      }
    >
      <LightbulbIcon aria-hidden className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate font-medium text-sidebar-foreground">
        Knowledge to keep
      </span>
      <span className="shrink-0 text-info tabular-nums">{candidates}</span>
    </button>
  );
}
