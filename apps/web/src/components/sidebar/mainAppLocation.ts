import { useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useUiStateStore } from "../../uiStateStore";
import { useSidebarView } from "../workspaces/SidebarViewSwitch";
import type { SidebarView } from "../workspaces/SidebarViewSwitch.logic";
import { viewOfPath, type SidebarRoutes } from "../workspaces/sidebarRoutes.logic";

export function isSidebarUtilityPage(pathname: string) {
  return (
    pathname === "/settings" ||
    pathname.startsWith("/settings/") ||
    pathname.startsWith("/projects/") ||
    pathname === "/usage" ||
    pathname === "/pull-requests"
  );
}

let mainAppHref: string | null = null;

export function MainAppLocationTracker() {
  const href = useLocation({
    select: (location) => (isSidebarUtilityPage(location.pathname) ? null : location.href),
  });
  useEffect(() => {
    if (href !== null) mainAppHref = href;
  }, [href]);
  return null;
}

export function mainAppReturnHref({
  view,
  routes,
  lastHref,
}: {
  view: SidebarView;
  routes: SidebarRoutes;
  lastHref: string | null;
}): string {
  if (routes[view]) return routes[view];
  if (lastHref !== null && viewOfPath(lastHref.split(/[?#]/u)[0] ?? "/") === view) {
    return lastHref;
  }
  return view === "work" ? "/work" : "/";
}

export function useNavigateToMainApp() {
  const navigate = useNavigate();
  const [view] = useSidebarView();
  return () =>
    navigate({
      href: mainAppReturnHref({
        view,
        routes: useUiStateStore.getState().sidebarRoutes,
        lastHref: mainAppHref,
      }),
    });
}
