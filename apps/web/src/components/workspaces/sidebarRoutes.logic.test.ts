import { describe, expect, it } from "vite-plus/test";

import {
  activeRouteKey,
  rememberRoute,
  routeForView,
  sanitizeRoutes,
  viewOfPath,
  type SidebarRoutes,
} from "./sidebarRoutes.logic";

describe("viewOfPath", () => {
  it("puts the Work screens, and what opens from them, under Tasks", () => {
    for (const path of [
      "/work",
      "/task/acme/app/t-1",
      "/review/acme/app/t-1",
      "/context/acme/app/task:t-1",
      "/knowledge/acme/app",
      "/memory/acme/app",
      "/team/acme/app",
      "/overlap/acme/app/o-1",
      "/observe/acme/laptop/th-1",
      "/agent/claude:1",
    ]) {
      expect(viewOfPath(path), path).toBe("work");
    }
  });

  it("puts chats, drafts and the landing page under Chats", () => {
    expect(viewOfPath("/env-1/thread-1")).toBe("threads");
    expect(viewOfPath("/draft/draft-1")).toBe("threads");
    expect(viewOfPath("/")).toBe("threads");
  });

  it("puts settings and the other utility pages under neither", () => {
    for (const path of [
      "/settings",
      "/settings/peer",
      "/settings/peer/w/acme/hub",
      "/usage",
      "/pull-requests",
      "/projects/github.com%2Facme%2Fapp",
      "/welcome",
      "/connect",
      "/pair",
    ]) {
      expect(viewOfPath(path), path).toBeNull();
    }
  });
});

describe("rememberRoute", () => {
  it("keeps the last screen of each view apart", () => {
    let routes: SidebarRoutes = {};
    routes = rememberRoute(routes, "/review/acme/app/t-1");
    routes = rememberRoute(routes, "/env-1/thread-1");
    routes = rememberRoute(routes, "/work");
    expect(routes).toEqual({ work: "/work", threads: "/env-1/thread-1" });
  });

  it("remembers the address with its search, and not its hash", () => {
    expect(rememberRoute({}, "/work?scope=acme#top").work).toBe("/work?scope=acme");
  });

  it("ignores settings, the landing page and a screen it already holds", () => {
    const routes: SidebarRoutes = { threads: "/env-1/thread-1" };
    expect(rememberRoute(routes, "/settings/peer")).toBe(routes);
    expect(rememberRoute(routes, "/pull-requests?state=open")).toBe(routes);
    expect(rememberRoute(routes, "/")).toBe(routes);
    expect(rememberRoute(routes, "/env-1/thread-1")).toBe(routes);
  });
});

describe("routeForView", () => {
  const routes: SidebarRoutes = { work: "/review/acme/app/t-1", threads: "/env-1/thread-1" };

  it("brings back the last screen of the view the person switches to", () => {
    expect(routeForView({ view: "work", current: "/env-1/thread-9", routes })).toEqual({
      kind: "remembered",
      href: "/review/acme/app/t-1",
    });
    expect(routeForView({ view: "threads", current: "/work", routes })).toEqual({
      kind: "remembered",
      href: "/env-1/thread-1",
    });
  });

  it("goes to the view's default before it has shown anything", () => {
    expect(routeForView({ view: "work", current: "/env-1/thread-9", routes: {} })).toEqual({
      kind: "default",
    });
    expect(routeForView({ view: "threads", current: "/work", routes: {} })).toEqual({
      kind: "default",
    });
  });

  it("stays on a screen that already belongs to the view", () => {
    expect(routeForView({ view: "work", current: "/review/acme/app/t-2", routes })).toEqual({
      kind: "stay",
    });
    expect(routeForView({ view: "threads", current: "/", routes })).toEqual({ kind: "stay" });
  });

  it("leaves settings for the view's screen", () => {
    expect(routeForView({ view: "work", current: "/settings/peer", routes })).toMatchObject({
      kind: "remembered",
    });
  });

  it("brings the Overview back when that was the last Work screen", () => {
    expect(
      routeForView({ view: "work", current: "/env-1/thread-9", routes: { work: "/work" } }),
    ).toEqual({ kind: "remembered", href: "/work" });
  });
});

describe("sanitizeRoutes", () => {
  it("keeps addresses on this app and drops the rest", () => {
    expect(
      sanitizeRoutes({ work: "/work", threads: "https://elsewhere.test/x", extra: "/y" }),
    ).toEqual({ work: "/work" });
    expect(sanitizeRoutes({ work: "//elsewhere.test" })).toEqual({});
    expect(sanitizeRoutes(null)).toEqual({});
    expect(sanitizeRoutes("/work")).toEqual({});
  });
});

describe("activeRouteKey", () => {
  it("names what each route shows, as the tree highlights it", () => {
    expect(activeRouteKey("/agent/claude:1", { agentId: "claude:1" })).toBe("agent:claude:1");
    expect(
      activeRouteKey("/context/acme/app/task:t-1", {
        workspace: "acme",
        project: "app",
        scope: "task:t-1",
      }),
    ).toBe("context:acme:app:task:t-1");
    // A task's page and its review both light up the task.
    for (const path of ["/task/acme/app/t-1", "/review/acme/app/t-1"]) {
      expect(activeRouteKey(path, { workspace: "acme", project: "app", task: "t-1" })).toBe(
        "task:acme:app:t-1",
      );
    }
    expect(
      activeRouteKey("/observe/acme/laptop/th-1", {
        workspace: "acme",
        environment: "laptop",
        thread: "th-1",
      }),
    ).toBe("observe:acme:laptop:th-1");
    expect(
      activeRouteKey("/env-1/thread-1", { environmentId: "env-1", threadId: "thread-1" }),
    ).toBe("env-1:thread-1");
    expect(activeRouteKey("/work", {})).toBeNull();
  });

  it("lights up Knowledge for its own pages and the Team page for its own, not Knowledge", () => {
    const project = { workspace: "acme", project: "app" };
    expect(activeRouteKey("/knowledge/acme/app", project)).toBe("knowledge:acme:app");
    expect(activeRouteKey("/memory/acme/app", project)).toBe("knowledge:acme:app");
    expect(activeRouteKey("/team/acme/app", project)).toBe("team:acme:app");
  });
});
