import { roomFeed, type RoomFeedRow } from "@t3tools/client-runtime/peer/rooms";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDownIcon, InboxIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { useSidebar } from "../ui/sidebar";
import type { ResolvedProjectScope } from "./projectScope.logic";
import { feedInScope } from "./rooms/roomFeed.logic";
import { roomTaskLabel } from "./rooms/roomSlots.logic";
import { needsYouText } from "./sidebarNav.logic";
import { useWorkData } from "./useWorkData";

/**
 * The bar at the foot of the sidebar: the rooms that wait on the person in the project in scope,
 * whichever tab shows, the Feed's first list. With none the bar is gone, since it asks for nothing.
 */
export function SidebarAttention({ scope }: { readonly scope: ResolvedProjectScope }) {
  const { status } = useWorkData();
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const [open, setOpen] = useState(false);
  const rows = feedInScope(roomFeed(status?.rooms), scope).filter((row) => row.state === "yours");
  if (status === null || rows.length === 0) return null;
  const leave = () => {
    if (isMobile) setOpenMobile(false);
  };
  const openRoom = ({ workspace, project, task }: RoomFeedRow) => {
    leave();
    void navigate({
      to: "/room/$workspace/$project/$task",
      params: { workspace, project, task },
    });
  };
  const showAll = () => {
    leave();
    void navigate({ to: "/work", search: { scope: scope.scope } });
  };
  return (
    <section
      aria-label="Needs your attention"
      className="mx-2 flex flex-col border-t border-sidebar-border pt-1"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex h-9 min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm font-medium text-sidebar-foreground outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <InboxIcon aria-hidden className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">Needs your attention</span>
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-warning/20 text-xs font-medium text-warning-foreground tabular-nums">
          {rows.length}
        </span>
        <ChevronDownIcon
          aria-hidden
          className={cn("size-4 shrink-0 text-muted-foreground", !open && "rotate-180")}
        />
      </button>
      {open ? (
        <div className="flex max-h-56 flex-col overflow-y-auto pb-1">
          <ul className="flex flex-col gap-0.5">
            {rows.map((row) => (
              <li key={row.key}>
                <button
                  type="button"
                  onClick={() => openRoom(row)}
                  className="flex w-full min-w-0 flex-col rounded-md px-2 py-1.5 text-left outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <span className="truncate text-sm text-sidebar-foreground">
                    {roomTaskLabel(status, row)}
                  </span>
                  <span className="truncate text-xs text-warning-foreground">
                    {needsYouText(row.needs) ?? "Blocked"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={showAll}
            className="mt-0.5 rounded-md px-2 py-1 text-left text-xs text-muted-foreground outline-none hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            Open all
          </button>
        </div>
      ) : null}
    </section>
  );
}
