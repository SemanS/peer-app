import type { PeerHubStatus, PeerPluginState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { PeerMobilePlugin } from "./slotTypes";
import { selectPeerPlugins, taskLauncherOf, workspaceSectionsAt } from "./slots.logic";

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

describe("workspace sections and the launcher", () => {
  const Nothing = () => null;
  const herdr: PeerMobilePlugin = {
    id: "herdr",
    workspaceSections: [{ place: "end", Component: Nothing }],
    taskLauncher: Nothing,
  };
  const requests: PeerMobilePlugin = {
    id: "requests",
    workspaceSections: [{ place: "tasks", Component: Nothing }],
  };

  it("lists a place's sections in registry order", () => {
    expect(workspaceSectionsAt([herdr, requests], "tasks").map((s) => s.id)).toEqual(["requests"]);
    expect(workspaceSectionsAt([herdr, requests], "end").map((s) => s.id)).toEqual(["herdr"]);
    expect(workspaceSectionsAt([], "end")).toEqual([]);
  });

  it("finds the plugin that starts agents, and none when it is off", () => {
    expect(taskLauncherOf([requests, herdr])).toBe(Nothing);
    expect(taskLauncherOf([requests])).toBeUndefined();
  });
});
