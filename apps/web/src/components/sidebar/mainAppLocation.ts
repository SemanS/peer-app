import { useNavigate, type AnyRouter } from "@tanstack/react-router";

import { useUiStateStore } from "../../uiStateStore";
import { useSidebarView } from "../workspaces/SidebarViewSwitch";
import type { SidebarView } from "../workspaces/SidebarViewSwitch.logic";
import { viewOfPath, type SidebarRoutes } from "../workspaces/sidebarRoutes.logic";

import { GUEST_PAGE_PATH } from "../../guestPage";

/** Settings and Usage open as modals over the last main-app view. */
export function isAppModalPage(pathname: string) {
  return pathname === "/settings" || pathname.startsWith("/settings/") || pathname === "/usage";
}

export function isSidebarUtilityPage(pathname: string) {
  return pathname.startsWith("/projects/") || pathname === "/pull-requests";
}

// Pages the root route always renders without the app shell, so they are never
// a page to return to. Other paths seen before auth or on a prompt-link landing
// are still recorded; they are real app URLs, so returning to one is harmless.
const SHELL_LESS_PATHS = new Set(["/pair", "/connect", "/connect-agent", GUEST_PAGE_PATH]);

let mainAppHref: string | null = null;
let appModalReturnHref: string | null = null;

/** Remembers where Settings, Usage, and the utility pages lead back to. */
export function startMainAppLocationTracking(router: AnyRouter): () => void {
  const record = () => {
    const { pathname, href } = router.state.location;
    if (isAppModalPage(pathname) || SHELL_LESS_PATHS.has(pathname)) return;
    appModalReturnHref = href;
    if (!isSidebarUtilityPage(pathname)) mainAppHref = href;
  };
  record();
  return router.subscribe("onResolved", record);
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

/** Leaves Settings or Usage for the page that opened it. */
export function useCloseAppModal() {
  const navigate = useNavigate();
  return () => navigate({ href: appModalReturnHref ?? mainAppHref ?? "/" });
}
