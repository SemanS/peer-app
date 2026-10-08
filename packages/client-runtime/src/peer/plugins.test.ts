import { AuthAccessWriteScope, AuthOrchestrationOperateScope } from "@t3tools/contracts";
import type { PeerHubStatus, PeerPluginState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { activePlugin, canChangePeerPlugins, inactivePluginReason } from "./plugins.ts";

const plugin = (
  id: string,
  state: Partial<Pick<PeerPluginState, "enabled" | "active" | "reason">> = {},
): PeerPluginState => ({
  id,
  title: id,
  enabled: true,
  active: true,
  ...state,
});

const status = (plugins?: ReadonlyArray<PeerPluginState>): Pick<PeerHubStatus, "plugins"> =>
  plugins === undefined ? {} : { plugins };

describe("activePlugin", () => {
  it("treats the features that existed before plugins as active without a plugin list", () => {
    for (const id of ["requests", "observe", "herdr", "github", "capacity", "knowledge"]) {
      expect(activePlugin(status(), id)).toBe(true);
    }
    expect(activePlugin(status(), "telepathy")).toBe(false);
  });

  it("treats an empty list like a missing one", () => {
    expect(activePlugin(status([]), "requests")).toBe(true);
    expect(activePlugin(status([]), "telepathy")).toBe(false);
  });

  it("follows the list once the environment sends one", () => {
    const listed = status([
      plugin("requests"),
      plugin("observe", { enabled: false, active: false, reason: "off" }),
      plugin("knowledge", { active: false, reason: "hub" }),
    ]);
    expect(activePlugin(listed, "requests")).toBe(true);
    expect(activePlugin(listed, "observe")).toBe(false);
    expect(activePlugin(listed, "knowledge")).toBe(false);
    // Not in the list: the environment does not have it.
    expect(activePlugin(listed, "herdr")).toBe(false);
  });

  it("shows nothing before the status has arrived", () => {
    expect(activePlugin(null, "requests")).toBe(false);
    expect(activePlugin(undefined, "requests")).toBe(false);
  });

  it("keeps memory hidden while the build excludes it", () => {
    expect(activePlugin(status(), "memory")).toBe(false);
    expect(activePlugin(status([plugin("memory")]), "memory")).toBe(false);
  });
});

describe("inactivePluginReason", () => {
  it("says why a plugin is not active", () => {
    const listed = status([
      plugin("requests"),
      plugin("observe", { enabled: false, active: false, reason: "off" }),
      plugin("knowledge", { active: false, reason: "hub" }),
    ]);
    expect(inactivePluginReason(listed, "requests")).toBeNull();
    expect(inactivePluginReason(listed, "observe")).toBe("off");
    expect(inactivePluginReason(listed, "knowledge")).toBe("hub");
    expect(inactivePluginReason(listed, "herdr")).toBe("missing");
    expect(inactivePluginReason(status(), "requests")).toBeNull();
  });

  it("offers nothing to turn on for memory while the build excludes it", () => {
    const off = status([plugin("memory", { enabled: false, active: false, reason: "off" })]);
    expect(inactivePluginReason(off, "memory")).toBe("missing");
    expect(inactivePluginReason(status(), "memory")).toBe("missing");
  });
});

describe("canChangePeerPlugins", () => {
  it("lets only a session with access-write change plugins", () => {
    expect(canChangePeerPlugins({ authenticated: true, scopes: [AuthAccessWriteScope] })).toBe(
      true,
    );
    expect(
      canChangePeerPlugins({ authenticated: true, scopes: [AuthOrchestrationOperateScope] }),
    ).toBe(false);
    expect(canChangePeerPlugins({ authenticated: true })).toBe(false);
    expect(canChangePeerPlugins({ authenticated: false, scopes: [AuthAccessWriteScope] })).toBe(
      false,
    );
    expect(canChangePeerPlugins(null)).toBe(false);
  });
});
