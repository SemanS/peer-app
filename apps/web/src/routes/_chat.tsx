import { useProjectScope } from "../components/workspaces/projectScope";
import { newChatProject, roomSetOf } from "../components/workspaces/projectScope.logic";
import { useSidebarProjectGroups } from "../hooks/useSidebarProjectGroups";
import { usePrimaryEnvironmentId } from "../state/environments";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { resolveNewChatAction } from "../lib/chatThreadActions";
import { isCommandPaletteOpen, openCommandPalette } from "../commandPaletteBus";
import { registerCommands } from "../shortcuts/dispatcher";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { Outlet, createFileRoute, redirect, useMatches, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useEffectEvent } from "react";

import { ThreadRouteView } from "../components/ThreadRouteView";
import { isAppModalPage } from "../components/sidebar/mainAppLocation";
import { SidebarInset } from "../components/ui/sidebar";
import { resolveThreadRouteTarget, type ThreadRouteTarget } from "../threadRoutes";
import { retainThreadFindForRoute } from "../components/chat/threadFindStore";
import { ThreadLinkPrompt } from "../components/promptLinks/ThreadLinkPrompt";
import { useThreadRouteTarget } from "../hooks/useThreadRouteTarget";

function threadRouteTargetKey(target: ThreadRouteTarget | null) {
  if (!target) return null;
  return target.kind === "server" ? scopedThreadKey(target.threadRef) : target.draftId;
}

function ChatRouteLayout() {
  const groups = useSidebarProjectGroups();
  const scope = useProjectScope(groups);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { handleNewThread } = useHandleNewThread();
  const navigate = useNavigate();
  const newChat = useEffectEvent((event: KeyboardEvent) => {
    const action = resolveNewChatAction({
      scopedProject: newChatProject(scope, primaryEnvironmentId),
      scopedSet: roomSetOf(scope),
      projectGroupCount: groups.length,
    });
    if (action.kind === "context") return false;
    event.preventDefault();
    event.stopPropagation();
    if (action.kind === "project") void handleNewThread(action.projectRef);
    else if (action.kind === "workspace")
      void navigate({ to: "/workspace/$setId", params: { setId: action.setId } });
    else openCommandPalette({ open: "new-thread-in" });
  });
  // Render both routes here so draft promotion keeps the same ChatView mounted.
  const threadTarget = useThreadRouteTarget();
  // Read matches, not location, so this agrees with the params useThreadRouteTarget reads.
  const modalOpen = useMatches({
    select: (matches) => matches.some((match) => isAppModalPage(match.pathname)),
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Registers the mounted Peer chat shortcut with the global command dispatcher.
  useEffect(
    () =>
      registerCommands(
        { "chat.new": (event) => newChat(event) },
        {
          when: () => !modalOpen && !isCommandPaletteOpen(),
        },
      ),
    [modalOpen],
  );
  // Settings and Usage render over the thread that opened them, so ChatView never remounts.
  const [backgroundTarget, setBackgroundTarget] = useState(threadTarget);
  if (!modalOpen && threadRouteTargetKey(backgroundTarget) !== threadRouteTargetKey(threadTarget)) {
    setBackgroundTarget(threadTarget);
  }
  const shownTarget = modalOpen ? backgroundTarget : threadTarget;
  return (
    <>
      {shownTarget?.kind === "server" && !modalOpen ? (
        <ThreadLinkPrompt threadRef={shownTarget.threadRef} />
      ) : null}
      {shownTarget ? (
        <ThreadRouteView target={shownTarget} background={modalOpen} />
      ) : modalOpen ? (
        <SidebarInset className="h-dvh" />
      ) : (
        <Outlet />
      )}
      {modalOpen ? <Outlet /> : null}
    </>
  );
}

export const Route = createFileRoute("/_chat")({
  beforeLoad: async ({ context, location }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
    return { appModalPage: isAppModalPage(location.pathname) };
  },
  component: ChatRouteLayout,
  // Every match carries the whole location's params, so this layout sees the thread route's too.
  onEnter: ({ context, params }) => retainThreadFindForRouteMatch(context.appModalPage, params),
  onStay: ({ context, params }) => retainThreadFindForRouteMatch(context.appModalPage, params),
  onLeave: () => retainThreadFindForRoute({ modalPage: false, threadRef: null }),
});

function retainThreadFindForRouteMatch(
  modalPage: boolean,
  params: Partial<Record<"environmentId" | "threadId", string>>,
) {
  const target = resolveThreadRouteTarget(params);
  retainThreadFindForRoute({
    modalPage,
    threadRef: target?.kind === "server" ? target.threadRef : null,
  });
}
