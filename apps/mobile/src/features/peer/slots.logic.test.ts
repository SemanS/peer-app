import type { PeerHubStatus, PeerPluginState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { PeerMobilePlugin } from "./slotTypes";
import { alwaysWorkspaceSectionsAt, selectPeerPlugins, workspaceSectionsAt } from "./slots.logic";

const REGISTRY = ["herdr", "requests", "memory"].map((id) => ({ id }));

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
    const listed = status([plugin("requests"), plugin("herdr", false), plugin("memory")]);
    // Memory stays hidden while the build excludes it.
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
    const impact: PeerMobilePlugin = {
      id: "impact",
      alwaysWorkspaceSections: [{ key: "settings", place: "end", Component: Nothing }],
    };
    const forecast: PeerMobilePlugin = {
      id: "forecast",
      alwaysWorkspaceSections: [{ key: "forecast", place: "tasks", Component: Nothing }],
    };
    const registry = [forecast, impact];
    const listed = status([plugin("impact", false), plugin("forecast", false)]);
    expect(workspaceSectionsAt(selectPeerPlugins(registry, listed), "end")).toEqual([]);
    expect(alwaysWorkspaceSectionsAt(registry, listed, "end").map((s) => s.key)).toEqual([
      "always:impact:settings",
    ]);
    expect(alwaysWorkspaceSectionsAt(registry, listed, "tasks").map((s) => s.key)).toEqual([
      "always:forecast:forecast",
    ]);
    expect(alwaysWorkspaceSectionsAt(registry, status([plugin("forecast")]), "end")).toEqual([]);
    expect(alwaysWorkspaceSectionsAt(registry, status(), "end")).toEqual([]);
    expect(alwaysWorkspaceSectionsAt(registry, null, "end")).toEqual([]);
  });
});

it("shows metrics only when active and keeps older environments quiet", () => {
  const registry = [...REGISTRY, { id: "metrics" }];
  expect(ids(selectPeerPlugins(registry, status([plugin("metrics")])))).toEqual(["metrics"]);
  expect(ids(selectPeerPlugins(registry, status([plugin("metrics", false)])))).toEqual([]);
  expect(ids(selectPeerPlugins(registry, status()))).not.toContain("metrics");
});

it("keeps impact task views out of older, disabled and forced-off environments", () => {
  const registry = [...REGISTRY, { id: "impact" }];
  expect(ids(selectPeerPlugins(registry, status([plugin("impact")])))).toEqual(["impact"]);
  for (const reason of ["off", "hub", "PEER_IMPACT=off"]) {
    expect(
      ids(
        selectPeerPlugins(
          registry,
          status([{ ...plugin("impact", false), enabled: reason !== "off", reason }]),
        ),
      ),
    ).not.toContain("impact");
  }
  expect(ids(selectPeerPlugins(registry, status()))).not.toContain("impact");
});

it("keeps plans task views out of older, disabled and forced-off environments", () => {
  const registry = [...REGISTRY, { id: "plans" }];
  expect(ids(selectPeerPlugins(registry, status([plugin("plans")])))).toEqual(["plans"]);
  for (const reason of ["off", "hub", "PEER_PLANS=off"]) {
    expect(
      ids(
        selectPeerPlugins(
          registry,
          status([{ ...plugin("plans", false), enabled: reason === "hub", reason }]),
        ),
      ),
    ).not.toContain("plans");
  }
  expect(ids(selectPeerPlugins(registry, status()))).not.toContain("plans");
});
