import type { PeerHubStatus, PeerPluginState, PeerWorkspaceState } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { workspaceNavRows } from "../sidebarNav.logic";
import { activeRouteKey, viewOfPath } from "../sidebarRoutes.logic";
import { PEER_WEB_PLUGINS, usePeerPlugins } from "../slots";
import type { PeerNavigate } from "../slots.types";
import { usageNavRow, usagePalette } from "./usagePalette";

const acme = { slug: "acme", name: "Acme" } as PeerWorkspaceState;

// `usePeerPlugins` only selects and caches; it calls no React hook, so it runs outside a component.
const active = (usage: boolean) =>
  usePeerPlugins({
    plugins: PEER_WEB_PLUGINS.map(({ id }): PeerPluginState => ({
      id,
      title: id,
      enabled: id !== "usage" || usage,
      active: id !== "usage" || usage,
      ...(id === "usage" && !usage ? { reason: "off" } : {}),
    })),
  });

describe("the sidebar row", () => {
  it("is there with the plugin on and absent with it off", () => {
    expect(workspaceNavRows(active(true), [acme]).map(({ id }) => id)).toEqual(["usage:acme"]);
    expect(workspaceNavRows(active(false), [acme])).toEqual([]);
  });

  it("opens the workspace's page and marks it while it shows", () => {
    const navigate = vi.fn();
    const row = usageNavRow(acme);
    void row.open(navigate as unknown as PeerNavigate);
    expect(navigate).toHaveBeenCalledWith({
      to: "/team-usage/$workspace",
      params: { workspace: "acme" },
    });
    const key = activeRouteKey("/team-usage/acme", { workspace: "acme" });
    expect(row.active?.(key)).toBe(true);
    expect(row.active?.("usage:other")).toBe(false);
  });

  it("keeps the sidebar on Tasks, apart from the local Usage page", () => {
    expect(viewOfPath("/team-usage/acme")).toBe("work");
    expect(viewOfPath("/usage")).toBeNull();
  });
});

describe("the command palette", () => {
  it("offers a page per workspace", () => {
    const status = {
      signedIn: true,
      workspaces: [acme, { slug: "beta", name: "Beta" }],
    } as Pick<PeerHubStatus, "signedIn" | "workspaces">;
    expect(usagePalette(status).map(({ title }) => title)).toEqual([
      "Workspace usage · Acme",
      "Workspace usage · Beta",
    ]);
  });

  it("offers nothing signed out, and nothing with the plugin off", () => {
    expect(usagePalette({ signedIn: false, workspaces: [] })).toEqual([]);
    expect(active(false).some((plugin) => plugin.id === "usage")).toBe(false);
  });
});
