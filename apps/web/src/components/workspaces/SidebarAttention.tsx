import { useNavigate } from "@tanstack/react-router";
import { ChevronDownIcon, InboxIcon } from "lucide-react";
import { useState } from "react";
import { taskShortTitle } from "@t3tools/client-runtime/peer/taskTitle";

import { cn } from "../../lib/utils";
import { useSidebar } from "../ui/sidebar";
import { isLocalScope, type ResolvedProjectScope } from "./projectScope.logic";
import { sidebarAttention, type AttentionRow } from "./sidebarAttention.logic";
import { useLocalProject } from "./StableWorkNavigation";
import { useWorkData } from "./useWorkData";
import { taskCards, type TaskTarget } from "./workBoard.logic";
import { attentionCards } from "./workNavigation.logic";

/**
 * The bar at the foot of the sidebar: what waits on the person in the project in scope, whichever
 * tab shows. It is the Needs your attention column of the board, the same cards; with none the bar
 * is gone, since it asks for nothing.
 */
export function SidebarAttention({ scope: resolved }: { readonly scope: ResolvedProjectScope }) {
  const scope = resolved.scope;
  const { tree, needs, actions, status } = useWorkData();
  const local = useLocalProject(resolved);
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const [open, setOpen] = useState(false);
  const cards = attentionCards(
    taskCards(tree, { scope, mine: false, query: "", needs, me: status?.email ?? null }),
  );
  if (cards.length === 0 && local.needs === 0) return null;
  const leave = () => {
    if (isMobile) setOpenMobile(false);
  };
  const go = (target: TaskTarget) => {
    leave();
    if (target.kind === "chat") {
      actions.open(target.open);
      return;
    }
    void navigate({
      to:
        target.kind === "task"
          ? "/task/$workspace/$project/$task"
          : "/review/$workspace/$project/$task",
      params: { workspace: target.workspace, project: target.project, task: target.task },
    });
  };
  const showAll = () => {
    leave();
    void navigate({ to: "/work", search: { view: "needs-you", scope } });
  };
  const rows = cards.map(sidebarAttention);
  const count = isLocalScope(scope) ? local.needs : cards.length;
  const openRow = (row: AttentionRow) => {
    if (row.target === undefined) showAll();
    else go(row.target);
  };
  return (
    <section
      aria-label="Needs your attention"
      className="mx-2 flex flex-col border-t border-sidebar-border pt-1"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => (rows.length === 0 ? showAll() : setOpen((value) => !value))}
        className="flex h-9 min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm font-medium text-sidebar-foreground outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <InboxIcon aria-hidden className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">Needs your attention</span>
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-warning/20 text-xs font-medium text-warning-foreground tabular-nums">
          {count}
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
                  onClick={() => openRow(row)}
                  className="flex w-full min-w-0 flex-col rounded-md px-2 py-1.5 text-left outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <span className="truncate text-sm text-sidebar-foreground">
                    {row.taskKey === undefined ? null : (
                      <span className="me-1.5 text-xs text-muted-foreground tabular-nums">
                        {row.taskKey}
                      </span>
                    )}
                    {taskShortTitle(row.title)}
                  </span>
                  <span className="truncate text-xs text-warning-foreground">{row.ask}</span>
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
