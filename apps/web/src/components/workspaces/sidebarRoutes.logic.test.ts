import { describe, expect, it } from "vite-plus/test";
import { createMemoryHistory } from "@tanstack/react-router";
import { mainAppReturnHref } from "../sidebar/mainAppLocation";

import {
  activeRouteKey,
  rememberRoute,
  routeForView,
  sanitizeRoutes,
  viewOfPath,
  sidebarViewForLocation,
  type SidebarRoutes,
} from "./sidebarRoutes.logic";

describe("viewOfPath", () => {
  it("puts the Work screens, and what opens from them, under Work", () => {
    for (const path of [
      "/work",
      "/room/acme/app/t-1",
      "/together/group-1",
      "/workspace/set-1",
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
    routes = rememberRoute(routes, "/room/acme/app/t-1");
    routes = rememberRoute(routes, "/env-1/thread-1");
    routes = rememberRoute(routes, "/work");
    expect(routes).toEqual({ work: "/work", threads: "/env-1/thread-1", lastView: "work" });
  });

  it("remembers the address with its search, and not its hash", () => {
    expect(rememberRoute({}, "/work?scope=acme#top").work).toBe("/work?scope=acme");
  });

  it("ignores settings, the landing page and a screen it already holds", () => {
    const routes: SidebarRoutes = { threads: "/env-1/thread-1", lastView: "threads" };
    expect(rememberRoute(routes, "/settings/peer")).toBe(routes);
    expect(rememberRoute(routes, "/pull-requests?state=open")).toBe(routes);
    expect(rememberRoute(routes, "/")).toBe(routes);
    expect(rememberRoute(routes, "/env-1/thread-1")).toBe(routes);
  });
});

describe("route-aware sidebar view", () => {
  it("follows work, room, chat and draft URLs despite a conflicting saved choice", () => {
    for (const pathname of ["/work", "/room/acme/app/t-1"]) {
      expect(sidebarViewForLocation(pathname, {}, "threads")).toBe("work");
    }
    for (const pathname of ["/env-1/thread-1", "/draft/d-1", "/"]) {
      expect(sidebarViewForLocation(pathname, {}, "work")).toBe("threads");
    }
  });

  it("returns Settings to Work after work → chat → browser Back to work", () => {
    const history = createMemoryHistory({ initialEntries: ["/work"] });
    let routes = rememberRoute({}, history.location.href);
    history.push("/env-1/thread-1");
    routes = rememberRoute(routes, history.location.href);
    expect(sidebarViewForLocation(history.location.pathname, routes, "threads")).toBe("threads");
    history.back();
    routes = rememberRoute(routes, history.location.href);
    expect(sidebarViewForLocation(history.location.pathname, routes, "threads")).toBe("work");
    history.push("/settings/general");
    routes = rememberRoute(routes, history.location.href);
    const view = sidebarViewForLocation(history.location.pathname, routes, "threads");
    expect(view).toBe("work");
    expect(mainAppReturnHref({ view, routes, lastHref: "/work" })).toBe("/work");
    history.back();
    expect(history.location.pathname).toBe("/work");
    history.forward();
    expect(history.location.pathname).toBe("/settings/general");
    history.destroy();
  });

  it("keeps the fallback preference when Settings was opened without main-view history", () => {
    expect(sidebarViewForLocation("/settings/general", {}, "threads")).toBe("threads");
    expect(sidebarViewForLocation("/settings/general", { lastView: "work" }, "threads")).toBe(
      "work",
    );
    expect(sanitizeRoutes({ lastView: "work" })).toEqual({ lastView: "work" });
    expect(sanitizeRoutes({ lastView: "invalid" })).toEqual({});
  });
});

describe("routeForView", () => {
  const routes: SidebarRoutes = { work: "/room/acme/app/t-1", threads: "/env-1/thread-1" };

  it("brings back the last screen of the view the person switches to", () => {
    expect(routeForView({ view: "work", current: "/env-1/thread-9", routes })).toEqual({
      kind: "remembered",
      href: "/room/acme/app/t-1",
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
    expect(routeForView({ view: "work", current: "/room/acme/app/t-2", routes })).toEqual({
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

  it("drops an address of a screen this app no longer has", () => {
    for (const screen of ["integration", "team-usage", "knowledge", "memory", "changes", "team"]) {
      expect(sanitizeRoutes({ work: `/${screen}/acme/app`, lastView: "work" })).toEqual({
        lastView: "work",
      });
    }
  });
});

describe("activeRouteKey", () => {
  it("names what each route shows, as the tree highlights it", () => {
    expect(activeRouteKey({ agentId: "claude:1" })).toBe("agent:claude:1");
    expect(activeRouteKey({ workspace: "acme", project: "app", task: "t-1" })).toBe(
      "task:acme:app:t-1",
    );
    expect(
      activeRouteKey({
        workspace: "acme",
        environment: "laptop",
        thread: "th-1",
      }),
    ).toBe("observe:acme:laptop:th-1");
    expect(activeRouteKey({ environmentId: "env-1", threadId: "thread-1" })).toBe("env-1:thread-1");
    expect(activeRouteKey({})).toBeNull();
  });

  it("lights nothing for a project's Operations page", () => {
    expect(activeRouteKey({ workspace: "acme", project: "app" })).toBeNull();
    expect(viewOfPath("/operations/acme/app")).toBe("work");
  });
});
