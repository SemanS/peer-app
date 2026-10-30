import { useAtomValue } from "@effect/atom-react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { LayoutGridIcon, SearchIcon } from "lucide-react";
import { PEER_LOCAL_WORKSPACE } from "@t3tools/contracts";

import { openCommandPalette } from "../../commandPaletteBus";
import { shortcutLabelForCommand } from "../../keybindings";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { Button } from "../ui/button";
import { useSidebar } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { chatScopeKeys, isLocalScope, type ResolvedProjectScope } from "./projectScope.logic";
import { usePeerHubStatus } from "./WorkspaceAccess";
import { useWorkData } from "./useWorkData";

/** Search and the board: what holds for every project, beside the project they start from. */
export function SidebarTools({ scope }: { readonly scope: string }) {
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const onBoard = useLocation({
    select: (location) => location.pathname === "/work" && location.search.view !== "needs-you",
  });
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const shortcut = shortcutLabelForCommand(keybindings, "commandPalette.toggle");
  return (
    <div className="flex shrink-0 items-center" role="navigation" aria-label="Peer navigation">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon-xs"
              variant="ghost-muted"
              aria-label="Search"
              onClick={() => openCommandPalette()}
            />
          }
        >
          <SearchIcon aria-hidden />
        </TooltipTrigger>
        <TooltipPopup side="bottom">
          {shortcut === null ? "Search" : `Search ${shortcut}`}
        </TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon-xs"
              variant="ghost-muted"
              aria-label="Overview"
              aria-current={onBoard ? "page" : undefined}
              onClick={() => {
                if (isMobile) setOpenMobile(false);
                void navigate({ to: "/work", search: { scope } });
              }}
            />
          }
        >
          <LayoutGridIcon aria-hidden />
        </TooltipTrigger>
        <TooltipPopup side="bottom">Overview</TooltipPopup>
      </Tooltip>
    </div>
  );
}

/**
 * What a project no workspace shares has of Peer: the chats and overlaps that wait on the person,
 * and the coordination record of its one Peer project, when there is one.
 */
export function useLocalProject(scope: ResolvedProjectScope) {
  const { status: primaryStatus, threads } = useWorkData();
  const local = isLocalScope(scope.scope);
  const targetEnvironment = local ? scope.refs?.[0]?.environmentId : undefined;
  const targetStatus = usePeerHubStatus(targetEnvironment ?? null);
  const status = targetEnvironment === undefined ? primaryStatus : targetStatus;
  const keys = chatScopeKeys(scope.refs);
  const localProjects = [
    ...new Map(
      (
        status?.coordination.local?.projects?.filter(
          (entry) => keys === null || keys.has(`${status.environmentId}:${entry.projectId}`),
        ) ?? []
      ).map((entry) => [entry.id, entry]),
    ).values(),
  ];
  const localIds = new Set(localProjects.map((entry) => entry.id));
  const needs = !local
    ? 0
    : threads.filter(
        (thread) =>
          keys?.has(`${thread.environmentId}:${thread.projectId}`) &&
          thread.deletedAt === null &&
          thread.archivedAt === null &&
          thread.lineage.relationshipToParent !== "subagent" &&
          (thread.hasPendingApprovals || thread.hasPendingUserInput),
      ).length +
      (status?.coordination.overlaps.filter(
        (overlap) => overlap.state === "open" && localIds.has(overlap.project),
      ).length ?? 0);
  const only = local && localProjects.length === 1 ? localProjects[0] : undefined;
  return {
    needs,
    context:
      only === undefined
        ? undefined
        : {
            params: {
              workspace: PEER_LOCAL_WORKSPACE,
              project: only.id,
              scope: "project-aggregate",
            },
            search: { environmentId: targetEnvironment },
          },
  };
}
