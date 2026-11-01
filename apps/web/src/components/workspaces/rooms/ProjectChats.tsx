import { Link, useLocation } from "@tanstack/react-router";
import { MessagesSquareIcon } from "lucide-react";
import type { ReactNode } from "react";

import { isSetScope } from "../projectSets.logic";
import type { ProjectSlotProps } from "../slots.types";
import { useSidebarRows } from "../useSidebarRows";
import { useWorkScope } from "../workScope";

const ROW =
  "flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-sm text-foreground hover:bg-accent";

/**
 * The project's rooms bound to no task: Chats are its own, Rooms reach across projects. A room
 * across projects has a chat in each and shows under every one of them, as all of them are in it;
 * only a workspace lists it once, above its projects.
 */
export function ProjectChats({ project, status }: ProjectSlotProps) {
  const [scope] = useWorkScope();
  const pathname = useLocation({ select: (location) => location.pathname });
  const groupOf = (chat: string) =>
    status.workspaces
      .find((workspace) => workspace.slug === project.workspace)
      ?.projects.find((state) => state.project.id === project.projectId)
      ?.work.tasks.find((task) => task.id === chat)?.group;
  const rows = (project.chats ?? []).map((chat) => ({ chat, group: groupOf(chat.id) }));
  const chats = rows.flatMap(({ chat, group }) => (group === undefined ? [chat] : []));
  const rooms = rows.flatMap(({ chat, group }) =>
    group === undefined ? [] : [{ title: chat.title, group }],
  );
  const pathOf = (chat: string) =>
    `/room/${encodeURIComponent(project.workspace)}/${encodeURIComponent(project.projectId)}/${encodeURIComponent(chat)}`;
  const shownChats = useSidebarRows(chats, (chat) => pathOf(chat.id) === pathname);
  const shownRooms = useSidebarRows(
    rooms,
    (room) => `/together/${encodeURIComponent(room.group)}` === pathname,
  );
  return (
    <>
      <Section title="Chats" empty="No chats yet." count={chats.length} more={shownChats.more}>
        {shownChats.visible.map((chat) => (
          <Link
            key={chat.id}
            to="/room/$workspace/$project/$task"
            params={{ workspace: project.workspace, project: project.projectId, task: chat.id }}
            className={ROW}
            activeProps={{ className: "bg-accent" }}
          >
            <MessagesSquareIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate">{chat.title}</span>
          </Link>
        ))}
      </Section>
      {isSetScope(scope) ? null : (
        <Section title="Rooms" empty="No rooms yet." count={rooms.length} more={shownRooms.more}>
          {shownRooms.visible.map((room) => (
            <Link
              key={room.group}
              to="/together/$group"
              params={{ group: room.group }}
              className={ROW}
              activeProps={{ className: "bg-accent" }}
            >
              <MessagesSquareIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">{room.title}</span>
            </Link>
          ))}
        </Section>
      )}
    </>
  );
}

function Section({
  title,
  empty,
  count,
  more,
  children,
}: {
  readonly title: string;
  readonly empty: string;
  readonly count: number;
  readonly more: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <h2 className="flex h-6 items-center px-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </h2>
      {count === 0 ? <p className="px-2 py-0.5 text-xs text-muted-foreground">{empty}</p> : null}
      {children}
      {more}
    </div>
  );
}
