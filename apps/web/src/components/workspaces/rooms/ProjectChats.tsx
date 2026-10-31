import { Link } from "@tanstack/react-router";
import { MessagesSquareIcon } from "lucide-react";

import type { ProjectSlotProps } from "../slots.types";

/** The project's chats: rooms bound to no task. A project without one shows nothing. */
export function ProjectChats({ project, status }: ProjectSlotProps) {
  const chats = project.chats ?? [];
  if (chats.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <h2 className="flex h-6 items-center px-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Chats
      </h2>
      {chats.map((chat) => {
        // A chat of a shared room opens as that room; the work tree leaves chats out of `tasks`.
        const group = status.workspaces
          .find((workspace) => workspace.slug === project.workspace)
          ?.projects.find((state) => state.project.id === project.projectId)
          ?.work.tasks.find((task) => task.id === chat.id)?.group;
        const row = (
          <>
            <MessagesSquareIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate">{chat.title}</span>
          </>
        );
        const look =
          "flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-sm text-foreground hover:bg-accent";
        return group === undefined ? (
          <Link
            key={chat.id}
            to="/room/$workspace/$project/$task"
            params={{ workspace: project.workspace, project: project.projectId, task: chat.id }}
            className={look}
            activeProps={{ className: "bg-accent" }}
          >
            {row}
          </Link>
        ) : (
          <Link
            key={chat.id}
            to="/together/$group"
            params={{ group }}
            className={look}
            activeProps={{ className: "bg-accent" }}
          >
            {row}
          </Link>
        );
      })}
    </div>
  );
}
