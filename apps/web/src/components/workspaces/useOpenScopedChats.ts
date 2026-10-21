import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";

import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useSidebarProjectGroups } from "../../hooks/useSidebarProjectGroups";
import { useThreadShells } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { buildThreadRouteParams } from "../../threadRoutes";
import { useSidebar } from "../ui/sidebar";
import { useProjectScope } from "./projectScope";
import { latestScopedChat, newChatProject } from "./projectScope.logic";
import { useSidebarView } from "./SidebarViewSwitch";

/** Show the scoped conversation list alongside its newest chat, or a draft when it has none. */
export function useOpenScopedChats() {
  const navigate = useNavigate();
  const groups = useSidebarProjectGroups();
  const scope = useProjectScope(groups);
  const threads = useThreadShells();
  const primary = usePrimaryEnvironmentId();
  const newThread = useNewThreadHandler();
  const [, setView] = useSidebarView();
  const { isMobile, setOpen, setOpenMobile } = useSidebar();
  const thread = latestScopedChat(threads, scope.refs);
  const project = newChatProject(scope, primary);
  return () => {
    setView("threads");
    if (isMobile) setOpenMobile(true);
    else setOpen(true);
    if (thread !== null) {
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.id)),
      });
    } else if (project !== null) {
      void newThread(project);
    } else {
      void navigate({ to: "/" });
    }
  };
}
