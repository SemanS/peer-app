import type { SidebarView } from "./SidebarViewSwitch.logic";

/** The screen each sidebar view last showed in the main area, as an address (path and search). */
export interface SidebarRoutes {
  readonly work?: string | undefined;
  readonly threads?: string | undefined;
  readonly lastView?: SidebarView | undefined;
}

/** Explicit routes win over a saved preference, including Back and direct links. */
export function sidebarViewForLocation(
  pathname: string,
  routes: SidebarRoutes,
  preferred: SidebarView,
): SidebarView {
  return viewOfPath(pathname) ?? routes.lastView ?? preferred;
}

/** The first path segments of the screens that belong to Tasks: the Work screens and what opens from them. */
const TASK_SCREENS: ReadonlySet<string> = new Set([
  "work",
  "task",
  "review",
  "context",
  "conversations",
  "knowledge",
  "memory",
  "team",
  "overlap",
  "observe",
  "agent",
  "changes",
  "operations",
  "integration",
]);

/** The first path segments of screens that belong to neither view: settings, usage, pull requests… */
const OTHER_SCREENS: ReadonlySet<string> = new Set([
  "settings",
  "usage",
  "pull-requests",
  "projects",
  "connect",
  "pair",
  "welcome",
]);

const pathnameOf = (href: string): string => href.split(/[?#]/u)[0] ?? "/";

/**
 * The view a screen belongs to: Tasks for the Work screens, Chats for a chat, a draft and the
 * landing page, none for settings and the other utility pages, which no view remembers.
 */
export function viewOfPath(pathname: string): SidebarView | null {
  const segments = pathname.split("/").filter((segment) => segment !== "");
  const root = segments[0];
  if (root === undefined || root === "draft") return "threads";
  if (TASK_SCREENS.has(root)) return "work";
  if (OTHER_SCREENS.has(root)) return null;
  // `/$environmentId/$threadId`.
  return segments.length === 2 ? "threads" : null;
}

/**
 * Records the screen the main area shows under its view, so switching back to the view returns to
 * it. Settings and the other utility pages are nobody's, and the landing page is where Chats start
 * rather than a screen to return to.
 */
export function rememberRoute(routes: SidebarRoutes, href: string): SidebarRoutes {
  const pathname = pathnameOf(href);
  const view = viewOfPath(pathname);
  // The hash only marks a spot within the screen.
  const address = href.split("#")[0] ?? href;
  if (view === null) return routes;
  if (pathname === "/") return routes.lastView === view ? routes : { ...routes, lastView: view };
  if (routes[view] === address && routes.lastView === view) return routes;
  return { ...routes, [view]: address, lastView: view };
}

/** What switching to a view does to the main area. */
export type ViewSwitchTarget =
  | { readonly kind: "stay" }
  | { readonly kind: "remembered"; readonly href: string }
  /** Tasks: the Overview. Chats: the newest chat. */
  | { readonly kind: "default" };

/**
 * Where switching to `view` goes: nowhere while the main area already shows one of its screens,
 * else the screen it showed last, else its default.
 */
export function routeForView(input: {
  readonly view: SidebarView;
  /** The pathname the main area shows now. */
  readonly current: string;
  readonly routes: SidebarRoutes;
}): ViewSwitchTarget {
  if (viewOfPath(input.current) === input.view) return { kind: "stay" };
  const remembered = input.routes[input.view];
  return remembered === undefined ? { kind: "default" } : { kind: "remembered", href: remembered };
}

/** A remembered address worth going back to: a path on this app, nothing that leaves it. */
function sanitizeRoute(value: unknown): string | undefined {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
    ? value
    : undefined;
}

/** The routes a persisted state holds, with anything unreadable dropped. */
export function sanitizeRoutes(value: unknown): SidebarRoutes {
  const record =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const work = sanitizeRoute(record.work);
  const threads = sanitizeRoute(record.threads);
  const lastView =
    record.lastView === "work" || record.lastView === "threads" ? record.lastView : undefined;
  return {
    ...(work === undefined ? {} : { work }),
    ...(threads === undefined ? {} : { threads }),
    ...(lastView === undefined ? {} : { lastView }),
  };
}

/**
 * What the sidebar highlights for the open route, in `workTree` terms: a chat by its environment
 * and thread, an agent, a task (its page and its review both), a context, a colleague's thread, and
 * for the pages of a whole project `knowledge:` (Knowledge, Memory), `team:` (the Team page and
 * its owner map) or `changes:` (Changes, and the Operations and integration preview pages that open
 * from it). Null where the route is none of these.
 */
export function activeRouteKey(
  pathname: string,
  params: Readonly<Record<string, string | undefined>>,
): string | null {
  const { agentId, workspace, project, scope, task, environment, thread } = params;
  if (agentId) return `agent:${agentId}`;
  if (workspace && project && scope) return `context:${workspace}:${project}:${scope}`;
  if (workspace && project && task) return `task:${workspace}:${project}:${task}`;
  if (workspace && project) {
    const root = pathname.split("/")[1];
    if (root === "team") return `team:${workspace}:${project}`;
    if (root === "changes" || root === "operations" || root === "integration")
      return `changes:${workspace}:${project}`;
    return `knowledge:${workspace}:${project}`;
  }
  if (workspace && environment && thread) return `observe:${workspace}:${environment}:${thread}`;
  if (params.environmentId && params.threadId) return `${params.environmentId}:${params.threadId}`;
  return null;
}
