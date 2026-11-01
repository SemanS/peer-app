import type { PeerHubStatus, PeerPluginState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { PeerMobilePlugin } from "./slotTypes";
import { alwaysWorkspaceSectionsAt, selectPeerPlugins, workspaceSectionsAt } from "./slots.logic";

const REGISTRY = ["herdr", "requests", "roles"].map((id) => ({ id }));

const plugin = (id: string, active = true): PeerPluginState => ({
  id,
  title: id,
  enabled: active,
  active,
  ...(active ? {} : { reason: "off" as const }),
});

const status = (plugins?: ReadonlyArray<PeerPluginState>): Pick<PeerHubStatus, "plugins"> =>
  plugins === undefined ? {} : { plugins };

const ids = (selected: ReadonlyArray<{ readonly id: string }>) => selected.map((p) => p.id);

describe("selectPeerPlugins", () => {
  it("selects only the plugins that are active, in registry order", () => {
    const listed = status([plugin("requests"), plugin("herdr", false)]);
    expect(ids(selectPeerPlugins(REGISTRY, listed))).toEqual(["requests"]);
    expect(ids(selectPeerPlugins(REGISTRY, status([plugin("requests"), plugin("herdr")])))).toEqual(
      ["herdr", "requests"],
    );
  });

  it("selects the features that existed before plugins when the status lists none", () => {
    expect(ids(selectPeerPlugins(REGISTRY, status()))).toEqual(["herdr", "requests"]);
    expect(ids(selectPeerPlugins(REGISTRY, status([])))).toEqual(["herdr", "requests"]);
  });

  it("ignores a plugin the registry does not know", () => {
    expect(
      ids(selectPeerPlugins(REGISTRY, status([plugin("telepathy"), plugin("herdr")]))),
    ).toEqual(["herdr"]);
  });

  it("selects nothing before the status has arrived", () => {
    expect(selectPeerPlugins(REGISTRY, null)).toEqual([]);
  });
});

describe("workspace sections", () => {
  const Nothing = () => null;
  const herdr: PeerMobilePlugin = {
    id: "herdr",
    workspaceSections: [{ place: "end", Component: Nothing }],
  };
  const requests: PeerMobilePlugin = {
    id: "requests",
    workspaceSections: [{ place: "tasks", Component: Nothing }],
  };

  it("lists a place's sections in registry order", () => {
    expect(workspaceSectionsAt([herdr, requests], "tasks").map((s) => s.key)).toEqual([
      "requests:0",
    ]);
    expect(workspaceSectionsAt([herdr, requests], "end").map((s) => s.key)).toEqual(["herdr:0"]);
    expect(workspaceSectionsAt([], "end")).toEqual([]);
  });

  it("keys every section of a plugin apart", () => {
    const both: PeerMobilePlugin = {
      id: "requests",
      workspaceSections: [
        { place: "tasks", Component: Nothing },
        { place: "end", Component: Nothing },
        { place: "tasks", Component: Nothing },
      ],
    };
    expect(workspaceSectionsAt([both], "tasks").map((s) => s.key)).toEqual([
      "requests:0",
      "requests:2",
    ]);
  });

  it("keeps registered inactive settings available at the end without showing unknown features", () => {
    const audit: PeerMobilePlugin = {
      id: "audit",
      alwaysWorkspaceSections: [{ key: "settings", place: "end", Component: Nothing }],
    };
    const changes: PeerMobilePlugin = {
      id: "changes",
      alwaysWorkspaceSections: [{ key: "changes", place: "tasks", Component: Nothing }],
    };
    const registry = [changes, audit];
    const listed = status([plugin("audit", false), plugin("changes", false)]);
    expect(workspaceSectionsAt(selectPeerPlugins(registry, listed), "end")).toEqual([]);
    expect(alwaysWorkspaceSectionsAt(registry, listed, "end").map((s) => s.key)).toEqual([
      "always:audit:settings",
    ]);
    expect(alwaysWorkspaceSectionsAt(registry, listed, "tasks").map((s) => s.key)).toEqual([
      "always:changes:changes",
    ]);
    expect(alwaysWorkspaceSectionsAt(registry, status([plugin("changes")]), "end")).toEqual([]);
    expect(alwaysWorkspaceSectionsAt(registry, status(), "end")).toEqual([]);
    expect(alwaysWorkspaceSectionsAt(registry, null, "end")).toEqual([]);
  });
});

it("shows a plugin only when active and keeps older environments quiet", () => {
  const registry = [...REGISTRY, { id: "audit" }];
  expect(ids(selectPeerPlugins(registry, status([plugin("audit")])))).toEqual(["audit"]);
  expect(ids(selectPeerPlugins(registry, status([plugin("audit", false)])))).toEqual([]);
  expect(ids(selectPeerPlugins(registry, status()))).not.toContain("audit");
});

it("keeps a plugin's task views out of older, disabled and forced-off environments", () => {
  const registry = [...REGISTRY, { id: "audit" }];
  expect(ids(selectPeerPlugins(registry, status([plugin("audit")])))).toEqual(["audit"]);
  for (const reason of ["off", "hub", "FORCED=off"]) {
    expect(
      ids(
        selectPeerPlugins(
          registry,
          status([{ ...plugin("audit", false), enabled: reason !== "off", reason }]),
        ),
      ),
    ).not.toContain("audit");
  }
  expect(ids(selectPeerPlugins(registry, status()))).not.toContain("audit");
});

it("keeps plans task views out of older, disabled and forced-off environments", () => {
  const registry = [...REGISTRY, { id: "agreements" }];
  expect(ids(selectPeerPlugins(registry, status([plugin("agreements")])))).toEqual(["agreements"]);
  for (const reason of ["off", "hub", "PEER_AGREEMENTS=off"]) {
    expect(
      ids(
        selectPeerPlugins(
          registry,
          status([{ ...plugin("agreements", false), enabled: reason === "hub", reason }]),
        ),
      ),
    ).not.toContain("agreements");
  }
  expect(ids(selectPeerPlugins(registry, status()))).not.toContain("agreements");
});
