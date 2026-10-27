// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { PeerProjectEntry, ScopeGroup } from "./projectScope.logic";

const source = vi.hoisted(() => ({ peer: [] as PeerProjectEntry[], groups: [] as ScopeGroup[] }));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => JSON.stringify(source.peer) }));
vi.mock("../../state/environments", () => ({ usePrimaryEnvironment: () => null }));
vi.mock("../../state/entities", () => ({ useThreadShell: () => null }));
vi.mock("../../state/server", () => ({ serverEnvironment: {} }));
vi.mock("./WorkspaceAccess", () => ({ usePeerHubStatus: () => null }));
import { useProjectScope, useWorkScopeUrl } from "./projectScope";
import { useActiveOrganization } from "./organizationChoice";
import { workSearch } from "./workNavigation.logic";

let root: Root | undefined;
let selection: ReturnType<typeof useProjectScope>;
let organization: ReturnType<typeof useActiveOrganization>;
function Shell() {
  const scope = useProjectScope(source.groups);
  const organizationState = useActiveOrganization();
  useLayoutEffect(() => {
    selection = scope;
    organization = organizationState;
  });
  return (
    <>
      <span>{scope.name ?? "All projects"}</span>
      <Outlet />
    </>
  );
}
function Work() {
  const scope = useProjectScope(source.groups);
  useWorkScopeUrl(scope.requestedScope);
  return <span>Work</span>;
}
function catalogs() {
  const ref = { environmentId: EnvironmentId.make("computer"), projectId: ProjectId.make("vocab") };
  source.peer = [{ scope: "team/vocab", name: "Vocabulift", refs: [ref] }];
  source.groups = [{ projectKey: "vocab", displayName: "Vocabulift", memberProjectRefs: [ref] }];
}
async function mount(url: string) {
  const base = createRootRoute({ component: Shell });
  const chat = createRoute({ getParentRoute: () => base, id: "_chat" });
  const work = createRoute({
    getParentRoute: () => chat,
    path: "work",
    validateSearch: workSearch,
    component: Work,
  });
  const prs = createRoute({
    getParentRoute: () => chat,
    path: "pull-requests",
    validateSearch: (raw) => raw,
    component: () => <span>Pull requests</span>,
  });
  const router = createRouter({
    routeTree: base.addChildren([chat.addChildren([work, prs])]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    await router.load();
    root!.render(<RouterProvider router={router} />);
  });
  return router;
}
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
  localStorage.clear();
  source.peer = [];
  source.groups = [];
});

describe("project context across navigation", () => {
  it("adopts the organization of a direct project link", async () => {
    catalogs();
    localStorage.setItem("peer:settings-workspace", JSON.stringify("other-team"));
    await mount("/work?scope=team%2Fvocab");
    expect(selection.scope).toBe("team/vocab");
    expect(organization.chosen).toBe("team");
  });
  it("adopts a direct link's organization when its catalog arrives later", async () => {
    localStorage.setItem("peer:settings-workspace", JSON.stringify("other-team"));
    const router = await mount("/work?scope=team%2Fvocab");
    expect(organization.chosen).toBe("other-team");
    catalogs();
    await act(async () => {
      await router.invalidate();
    });
    expect(selection.scope).toBe("team/vocab");
    expect(organization.chosen).toBe("team");
  });
  it("preserves a saved project until delayed catalogs arrive", async () => {
    localStorage.setItem("peer:work-scope", JSON.stringify("team/vocab"));
    const router = await mount("/work");
    expect(router.state.location.search.scope).toBe("team/vocab");
    catalogs();
    await act(async () => {
      await router.invalidate();
    });
    expect(selection.scope).toBe("team/vocab");
    expect(selection.name).toBe("Vocabulift");
  });
  it("updates the URL through the same setter used by filter-by-project", async () => {
    catalogs();
    const router = await mount("/work?scope=team%2Fvocab");
    await act(async () => {
      selection.setScope("all");
    });
    expect(router.state.location.search.scope).toBe("all");
    expect(selection.scope).toBe("all");
  });
  it("clears a PR project's URL filter through that setter and restores it on Back", async () => {
    catalogs();
    const router = await mount("/pull-requests?projectId=vocab&environmentId=computer");
    expect(selection.scope).toBe("team/vocab");
    await act(async () => {
      selection.setScope("all");
    });
    expect(router.state.location.search.projectId).toBeUndefined();
    expect(selection.scope).toBe("all");
    await act(async () => {
      router.history.back();
    });
    expect(selection.scope).toBe("team/vocab");
  });
  it("clears a different organization's Work scope when switching organizations", async () => {
    catalogs();
    const router = await mount("/work?scope=team%2Fvocab");
    await act(async () => {
      organization.choose("other-team");
    });
    expect(router.state.location.search.scope).toBe("all");
    expect(selection.scope).toBe("all");
    expect(organization.chosen).toBe("other-team");
    await act(async () => {
      router.history.back();
    });
    expect(selection.scope).toBe("team/vocab");
    expect(organization.chosen).toBe("team");
  });
});
